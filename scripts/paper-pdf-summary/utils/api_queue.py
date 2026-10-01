import asyncio
import json
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from utils.project_root import PROJECT_ROOT
from utils.database import get_connection
from utils.pdf_downloader import load_config, create_download_directory, download_pdf
from utils.pdf_validator import validate_and_cleanup
from utils.pdf_summarizer import summarize_pdf
from utils.summary_uploader import upload_all as parallel_upload, get_env_bool
from utils.logger import DailyLogger
import yaml

# 结果保留时长（秒）：任务完成后保留一段时间供 GET /process/status 轮询读取
RESULT_TTL_SECONDS = 300

# 落盘结果的保留时长（秒）：跨服务重启可查，弥补内存态重启即丢
PERSISTED_RESULT_TTL_SECONDS = 86400

# 摘要流水线阶段（推送不属于摘要成败判定）
PIPELINE_STAGES = ("pdf_download", "pdf_validate", "pdf_summary")

# 推送目标全集，顺序即 distribution 列表展示顺序
DISTRIBUTION_TARGETS = ("hiagent_rag", "lis_rss", "memos", "blinko", "wechat")

# 稳定错误码：调用方按码路由，不再匹配中文 reason 文案
ERR_PDF_UNAVAILABLE = "pdf_unavailable"
ERR_TITLE_MISMATCH = "title_mismatch"
ERR_SUMMARY_FAILED = "summary_failed"
ERR_SUMMARY_EMPTY = "summary_empty"
ERR_DISTRIBUTION_FAILED = "distribution_failed"
ERR_INTERNAL = "internal_error"

# 有效任务状态集合
VALID_STATUSES = {"queued", "running", "completed", "failed"}


def load_workflow_config(config_path: str = None) -> Dict:
    if config_path is None:
        config_path = str(PROJECT_ROOT / "config" / "config.yaml")
    config_path = Path(config_path)
    if not config_path.exists():
        raise FileNotFoundError(f"配置文件不存在: {config_path}")
    with open(config_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def build_distribution(upload_results: Optional[Dict]) -> Dict:
    """
    upload_all 的原始结果 → 面向调用方的推送视图。

    原始 dict 里 bool=False 有「被跳过」和「真失败」两种含义，只能靠 _skipped 区分；
    这里显式拆成 ok / failed / skipped 三段，避免调用方自行推断。
    """
    if not upload_results:
        return {"requested": [], "ok": [], "failed": [], "skipped": [], "error": None}

    skipped = [t for t in DISTRIBUTION_TARGETS if t in (upload_results.get("_skipped") or [])]
    ok = [t for t in DISTRIBUTION_TARGETS if upload_results.get(t) is True and t not in skipped]
    failed = [t for t in DISTRIBUTION_TARGETS if upload_results.get(t) is False and t not in skipped]
    error = upload_results.get("error") if isinstance(upload_results.get("error"), str) else None

    # upload 整体异常（如 {"error": "..."}）：没有逐项结果，未被跳过的目标视为全部失败
    if error and not ok and not failed:
        failed = [t for t in DISTRIBUTION_TARGETS if t not in skipped]

    return {
        "requested": [t for t in DISTRIBUTION_TARGETS if t not in skipped],
        "ok": ok,
        "failed": failed,
        "skipped": skipped,
        "error": error,
    }


def pipeline_succeeded(stages: Dict, md_content: Optional[str]) -> bool:
    """
    摘要流水线是否成功：只认 pdf_download / pdf_validate / pdf_summary 三段 + 摘要正文非空。

    推送结果（distribution）不参与判定——推送全跳过或全失败都不改变摘要本身的成败。
    """
    if any(stages.get(name) != "success" for name in PIPELINE_STAGES):
        return False
    return isinstance(md_content, str) and bool(md_content.strip())


class QueueManager:
    def __init__(self, max_concurrent: int = 1):
        self.queue: asyncio.Queue = asyncio.Queue()
        self.results: Dict[str, Dict] = {}
        self.events: Dict[str, asyncio.Event] = {}
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self._worker_task: Optional[asyncio.Task] = None
        self._config: Optional[Dict] = None
        self._logger_initialized = False

    def _ensure_worker(self):
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker())
            self._worker_initialized = True

    def _ensure_config(self) -> Dict:
        if self._config is None:
            self._config = load_workflow_config(str(PROJECT_ROOT / "config" / "config.yaml"))
        return self._config

    @property
    def _tasks_dir(self) -> Path:
        logs_root = self._ensure_config().get('storage', {}).get('logs_root', 'logs')
        return PROJECT_ROOT / logs_root / 'tasks'

    def load_persisted_results(self) -> int:
        """
        回载历史任务结果，使服务重启后已终结任务仍可查（内存态重启即丢是旧行为）。

        Returns:
            回载条数
        """
        tasks_dir = self._tasks_dir
        if not tasks_dir.is_dir():
            return 0

        now = time.time()
        loaded = 0
        for path in tasks_dir.glob('*.json'):
            try:
                snapshot = json.loads(path.read_text(encoding='utf-8'))
            except (OSError, ValueError):
                continue
            task_id = snapshot.get('task_id')
            finished_at = snapshot.get('finished_at')
            if not task_id or not finished_at or task_id in self.results:
                continue
            if now - finished_at > PERSISTED_RESULT_TTL_SECONDS:
                continue  # 过期文件由 _cleanup_expired_results 删除
            snapshot['persisted'] = True
            self.results[task_id] = snapshot
            loaded += 1
        return loaded

    def _persist_result(self, snapshot: Dict) -> None:
        """任务终结后落盘（写失败不影响主链路，仅失去跨重启可查性）"""
        try:
            tasks_dir = self._tasks_dir
            tasks_dir.mkdir(parents=True, exist_ok=True)
            payload = {k: v for k, v in snapshot.items() if k != 'persisted'}
            (tasks_dir / f"{snapshot['task_id']}.json").write_text(
                json.dumps(payload, ensure_ascii=False), encoding='utf-8'
            )
        except (OSError, KeyError, TypeError, ValueError) as e:
            print(f"[警告] 任务结果落盘失败（不影响本次处理结果）: {e}")

    async def enqueue(self, title: str, article_id: Optional[int], push_wechat: Optional[bool] = None, push_hiagent: Optional[bool] = None, push_memos: Optional[bool] = None, push_blinko: Optional[bool] = None):
        """
        提交处理任务。

        push_* 均为三态：None 沿用服务端配置，True 强制推送，False 强制跳过。

        Returns:
            (task_id, is_duplicate) 元组。同一标题（忽略大小写/首尾空白）
            已有在途任务（queued/running）时不重复入队，返回现有 task_id 与 True。
        """
        normalized = title.strip().lower()
        for existing_id, snapshot in self.results.items():
            if (
                snapshot.get("status") in ("queued", "running")
                and snapshot.get("title", "").strip().lower() == normalized
            ):
                return existing_id, True

        task_id = str(uuid.uuid4())
        self._ensure_worker()

        self.events[task_id] = asyncio.Event()
        self.results[task_id] = {
            "task_id": task_id,
            "title": title,
            "article_id": article_id,
            "push_wechat": push_wechat,
            "push_hiagent": push_hiagent,
            "push_memos": push_memos,
            "push_blinko": push_blinko,
            "status": "queued",
            "stage": "queued",
            "queued_at": time.time(),
            "started_at": None,
            "finished_at": None,
            "result": None
        }

        await self.queue.put({
            "task_id": task_id,
            "title": title,
            "article_id": article_id,
            "push_wechat": push_wechat,
            "push_hiagent": push_hiagent,
            "push_memos": push_memos,
            "push_blinko": push_blinko,
        })

        self._cleanup_expired_results()

        return task_id, False

    async def get_result(self, task_id: str) -> Optional[Dict]:
        """
        阻塞等待任务完成并返回结果（非破坏性读取，多等待者安全）。

        记录由 TTL 清理机制回收，读取时不再 pop，避免去重场景下
        多个等待者（重复提交命中同一任务）中先到者取空。

        Returns:
            终态结果；task_id 不存在或已过期返回 None
        """
        if task_id not in self.events:
            return None

        await self.events[task_id].wait()

        snapshot = self.results.get(task_id)
        if snapshot is None:
            return None

        return snapshot.get("result")

    async def get_task_status(self, task_id: str, include_result: bool = True) -> Optional[Dict]:
        """
        查询任务实时状态（供状态轮询端点使用）。

        include_result=False 时只返回轻量进度视图（不含 result / 摘要正文），
        供高频轮询使用，避免每轮都搬运整篇摘要。

        Returns:
            任务状态快照；task_id 不存在或已过期返回 None
        """
        snapshot = self.results.get(task_id)
        if snapshot is None:
            return None

        status = snapshot.get("status")
        finished_at = snapshot.get("finished_at")

        # 超过 TTL 的已完成任务视为过期（落盘回载的任务保留更久）
        if finished_at:
            ttl = PERSISTED_RESULT_TTL_SECONDS if snapshot.get("persisted") else RESULT_TTL_SECONDS
            if (time.time() - finished_at) > ttl:
                return None

        elapsed = None
        if snapshot.get("started_at"):
            end = finished_at or time.time()
            elapsed = round(end - snapshot["started_at"], 1)

        queue_wait = None
        if status == "queued" and snapshot.get("queued_at"):
            queue_wait = round(time.time() - snapshot["queued_at"], 1)

        result = snapshot.get("result")

        payload = {
            "task_id": task_id,
            "title": snapshot.get("title"),
            "status": status,
            "stage": snapshot.get("stage"),
            "elapsed_seconds": elapsed,
            "queue_wait_seconds": queue_wait,
            "queued_at": snapshot.get("queued_at"),
            "finished_at": finished_at,
            "error_code": (result or {}).get("error_code"),
        }

        if include_result:
            payload["result"] = result
        else:
            payload["error_code"] = (result or {}).get("error_code")

        return payload

    def _cleanup_expired_results(self) -> None:
        """
        清理超过 TTL 的任务记录，避免内存字典与 logs/tasks 目录无限增长。

        内存态与落盘态 TTL 不同（5 分钟 / 24 小时），因此分两把尺子量：
        内存条目按 RESULT_TTL 判定，落盘文件按 PERSISTED_RESULT_TTL 判定——
        不能因为内存条目到期就删掉仍有 24 小时效力的文件。
        """
        now = time.time()

        for task_id in list(self.results.keys()):
            snapshot = self.results[task_id]
            finished_at = snapshot.get("finished_at")
            if not finished_at:
                continue
            ttl = PERSISTED_RESULT_TTL_SECONDS if snapshot.get("persisted") else RESULT_TTL_SECONDS
            if (now - finished_at) > ttl:
                self.results.pop(task_id, None)
                self.events.pop(task_id, None)

        # 落盘文件单独按落盘 TTL 清理（含重启前遗留的）
        try:
            paths = list(self._tasks_dir.glob('*.json'))
        except OSError:
            return
        for path in paths:
            try:
                finished_at = json.loads(path.read_text(encoding='utf-8')).get('finished_at')
            except (OSError, ValueError):
                finished_at = None
            if not finished_at or (now - finished_at) > PERSISTED_RESULT_TTL_SECONDS:
                try:
                    path.unlink()
                except OSError:
                    pass

    def _set_stage(self, task_id: str, stage: str) -> None:
        """更新任务当前阶段（心跳可见的进度信息）"""
        snapshot = self.results.get(task_id)
        if snapshot is not None:
            snapshot["stage"] = stage

    async def _process_single_article(self, task_id: str, title: str, article_id: Optional[int], push_wechat: Optional[bool] = None, push_hiagent: Optional[bool] = None, push_memos: Optional[bool] = None, push_blinko: Optional[bool] = None) -> Dict:
        article_id = article_id if article_id else 0
        skip_lis_rss = article_id == 0
        # 三态：None 沿用环境变量默认，False 强制不推（客户端可真正关闭该通道）
        env_default_push_wechat = get_env_bool('PDF_SUMMARY_PUSH_WECHAT', False)
        final_push_wechat = env_default_push_wechat if push_wechat is None else bool(push_wechat)

        config = self._ensure_config()
        today = datetime.now().strftime("%Y-%m-%d")

        result = {
            "article_id": article_id,
            "title": title,
            "success": False,
            "error_code": None,
            "reason": None,
            "stages": {},
            "distribution": None,
        }

        self._set_stage(task_id, "pdf_download")
        download_root = config['storage']['download_root']
        daily_dir = create_download_directory(download_root, today)

        # download_pdf 内部使用 subprocess.run（最长600s/脚本），
        # 放入线程执行避免阻塞事件循环，保证 /health 与状态轮询端点可用
        pdf_path = await asyncio.to_thread(
            download_pdf,
            title=title,
            output_dir=str(daily_dir),
            config=config
        )

        if not pdf_path:
            result["error_code"] = ERR_PDF_UNAVAILABLE
            result["reason"] = "PDF下载失败（所有脚本均失败）"
            return result

        result["stages"]["pdf_download"] = "success"

        self._set_stage(task_id, "pdf_validate")
        threshold = config.get('pdf_download', {}).get('match_threshold', 0)
        matched, match_reason = await asyncio.to_thread(
            validate_and_cleanup,
            pdf_path=pdf_path,
            original_title=title,
            threshold=threshold,
            delete_on_mismatch=True
        )

        if not matched:
            result["stages"]["pdf_validate"] = "failed"
            result["error_code"] = ERR_TITLE_MISMATCH
            result["reason"] = f"PDF文件名不匹配: {match_reason}"
            return result

        result["stages"]["pdf_validate"] = "success"

        self._set_stage(task_id, "pdf_summary")
        # summarize_pdf 使用 Popen 阻塞读取子进程输出（HiAgent 摘要通常 1-3 分钟），
        # 同样放入线程执行
        md_path = await asyncio.to_thread(summarize_pdf, pdf_path, config)

        if not md_path:
            result["stages"]["pdf_summary"] = "failed"
            result["error_code"] = ERR_SUMMARY_FAILED
            result["reason"] = "PDF总结失败"
            return result

        self._set_stage(task_id, "pdf_summary_check")
        # 读取MD内容检查是否包含错误信息
        md_content = ""
        if Path(md_path).exists():
            md_content = Path(md_path).read_text(encoding='utf-8')

        error_patterns = [
            r'无法完成',
            r'无法正常',
            r'No /Root object',
            r'Is this really a PDF',
            r'^文件链接无法正常访问',
            r'^文件格式异常',
            r'^链接无效',
            r'^格式异常',
            r'PDF.*?异常',
            r'处理失败',
            r'调用失败',
            r'抱歉.*?无法.*?',
            r'对不起.*?无法.*?',
            r'请求异常',
            r'稍后重试',
            r'请稍后重试'
        ]
        has_error = any(re.search(p, md_content, re.IGNORECASE) for p in error_patterns)
        if has_error:
            reason = "PDF总结失败（生成的摘要包含错误信息，可能是PDF损坏或无法读取）"
            print(f"[失败] {reason}")
            print(f"[删除] 删除无效MD文件: {md_path}")
            Path(md_path).unlink(missing_ok=True)
            result["stages"]["pdf_summary"] = "failed"
            result["error_code"] = ERR_SUMMARY_FAILED
            result["reason"] = reason
            return result

        result["stages"]["pdf_summary"] = "success"
        result["md_path"] = str(md_path)
        result["md_content"] = md_content

        # 推送是独立副作用：无论成功、失败还是全部跳过，都不改变上面的 success 判定
        self._set_stage(task_id, "upload")
        try:
            upload_results = await parallel_upload(
                md_path=str(md_path),
                article_id=article_id,
                article_title=title,
                source_name="API调用",
                config=config,
                skip_lis_rss=skip_lis_rss,
                skip_wechat=not final_push_wechat,
                push_hiagent=push_hiagent,
                push_memos=push_memos,
                push_blinko=push_blinko,
            )
            result["stages"]["upload"] = upload_results
            result["distribution"] = build_distribution(upload_results)
        except Exception as e:
            result["stages"]["upload"] = {"error": str(e)}
            result["distribution"] = build_distribution({"error": str(e)})

        result["success"] = pipeline_succeeded(result["stages"], md_content)
        if not result["success"]:
            result["error_code"] = ERR_SUMMARY_EMPTY

        return result

    async def _worker(self):
        while True:
            task = await self.queue.get()

            async with self.semaphore:
                task_id = task["task_id"]
                title = task["title"]
                article_id = task["article_id"]
                push_wechat = task.get("push_wechat")
                push_hiagent = task.get("push_hiagent")
                push_memos = task.get("push_memos")
                push_blinko = task.get("push_blinko")

                snapshot = self.results.get(task_id)
                if snapshot is not None:
                    snapshot["status"] = "running"
                    snapshot["started_at"] = time.time()

                try:
                    result = await self._process_single_article(task_id, title, article_id, push_wechat, push_hiagent, push_memos, push_blinko)
                    if snapshot is not None:
                        snapshot["result"] = result
                        # status 只表达「任务执行终态」；业务成败看 result.success / result.error_code
                        snapshot["status"] = "completed"
                except Exception as e:
                    if snapshot is not None:
                        snapshot["result"] = {
                            "success": False,
                            "error_code": ERR_INTERNAL,
                            "reason": f"处理异常: {e}",
                            "article_id": task["article_id"],
                            "title": title,
                            "stages": {},
                            "distribution": None,
                        }
                        snapshot["status"] = "failed"
                finally:
                    if snapshot is not None:
                        snapshot["finished_at"] = time.time()
                        self._persist_result(snapshot)
                    if task_id in self.events:
                        self.events[task_id].set()

            self.queue.task_done()

    async def get_queue_size(self) -> int:
        return self.queue.qsize()

    async def get_status(self, task_id: str) -> Optional[Dict]:
        return self.results.get(task_id)
