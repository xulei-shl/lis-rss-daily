import asyncio
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

    async def enqueue(self, title: str, article_id: Optional[int], push_wechat: bool = False, push_hiagent: Optional[bool] = None, push_memos: Optional[bool] = None, push_blinko: Optional[bool] = None):
        """
        提交处理任务。

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

    async def get_result(self, task_id: str) -> Dict:
        """
        阻塞等待任务完成并返回结果（非破坏性读取，多等待者安全）。

        记录由 TTL 清理机制回收，读取时不再 pop，避免去重场景下
        多个等待者（重复提交命中同一任务）中先到者取空。
        """
        if task_id not in self.events:
            return {"error": "Task not found"}

        await self.events[task_id].wait()

        snapshot = self.results.get(task_id)
        if snapshot is None:
            return {"error": "Task not found"}

        return snapshot.get("result") or {"success": False, "reason": "Unknown error"}

    async def get_task_status(self, task_id: str) -> Optional[Dict]:
        """
        查询任务实时状态（供状态轮询端点使用）。

        Returns:
            任务状态快照；task_id 不存在或已过期返回 None
        """
        snapshot = self.results.get(task_id)
        if snapshot is None:
            return None

        status = snapshot.get("status")

        # 超过 TTL 的已完成任务视为过期
        if snapshot.get("finished_at") and (time.time() - snapshot["finished_at"]) > RESULT_TTL_SECONDS:
            return None

        elapsed = None
        if snapshot.get("started_at"):
            end = snapshot.get("finished_at") or time.time()
            elapsed = round(end - snapshot["started_at"], 1)

        queue_wait = None
        if status == "queued" and snapshot.get("queued_at"):
            queue_wait = round(time.time() - snapshot["queued_at"], 1)

        return {
            "task_id": task_id,
            "title": snapshot.get("title"),
            "status": status,
            "stage": snapshot.get("stage"),
            "elapsed_seconds": elapsed,
            "queue_wait_seconds": queue_wait,
            "queued_at": snapshot.get("queued_at"),
            "finished_at": snapshot.get("finished_at"),
            "result": snapshot.get("result"),
        }

    async def _is_all_upload_failed(self, upload_results: Optional[Dict]) -> bool:
        if not upload_results:
            return True
        skipped = upload_results.get('_skipped', [])
        success_count = 0
        if 'hiagent_rag' not in skipped and upload_results.get('hiagent_rag', False):
            success_count += 1
        if 'lis_rss' not in skipped and upload_results.get('lis_rss', False):
            success_count += 1
        if 'memos' not in skipped and upload_results.get('memos', False):
            success_count += 1
        if 'blinko' not in skipped and upload_results.get('blinko', False):
            success_count += 1
        if 'wechat' not in skipped and upload_results.get('wechat', False):
            success_count += 1
        return success_count == 0

    def _cleanup_expired_results(self) -> None:
        """清理超过 TTL 的已完成任务记录，避免 results/events 字典无限增长"""
        now = time.time()
        for task_id in list(self.results.keys()):
            snapshot = self.results[task_id]
            finished_at = snapshot.get("finished_at")
            if finished_at and (now - finished_at) > RESULT_TTL_SECONDS:
                self.results.pop(task_id, None)
                self.events.pop(task_id, None)

    def _set_stage(self, task_id: str, stage: str) -> None:
        """更新任务当前阶段（心跳可见的进度信息）"""
        snapshot = self.results.get(task_id)
        if snapshot is not None:
            snapshot["stage"] = stage

    async def _process_single_article(self, task_id: str, title: str, article_id: Optional[int], push_wechat: bool = False, push_hiagent: Optional[bool] = None, push_memos: Optional[bool] = None, push_blinko: Optional[bool] = None) -> Dict:
        article_id = article_id if article_id else 0
        skip_lis_rss = article_id == 0
        default_push_wechat = get_env_bool('PDF_SUMMARY_PUSH_WECHAT', False)
        final_push_wechat = push_wechat or default_push_wechat

        config = self._ensure_config()
        today = datetime.now().strftime("%Y-%m-%d")

        result = {
            "article_id": article_id,
            "title": title,
            "success": False,
            "stages": {}
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
            result["reason"] = f"PDF文件名不匹配: {match_reason}"
            return result

        result["stages"]["pdf_validate"] = "success"

        self._set_stage(task_id, "pdf_summary")
        # summarize_pdf 使用 Popen 阻塞读取子进程输出（HiAgent 摘要通常 1-3 分钟），
        # 同样放入线程执行
        md_path = await asyncio.to_thread(summarize_pdf, pdf_path, config)

        if not md_path:
            result["stages"]["pdf_summary"] = "failed"
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
            r'文件链接无法正常访问',
            r'文件格式异常',
            r'链接无效',
            r'格式异常',
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
            result["reason"] = reason
            return result

        result["stages"]["pdf_summary"] = "success"
        result["md_path"] = str(md_path)
        result["md_content"] = md_content

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
        except Exception as e:
            result["stages"]["upload"] = {"error": str(e)}
            result["reason"] = f"上传过程异常: {e}"
            return result

        is_fully_successful = (
            result["stages"].get("pdf_download") == "success" and
            result["stages"].get("pdf_summary") == "success" and
            not await self._is_all_upload_failed(result["stages"].get("upload"))
        )

        result["success"] = is_fully_successful
        if not is_fully_successful and "reason" not in result:
            result["reason"] = "部分上传任务失败"

        return result

    async def _worker(self):
        while True:
            task = await self.queue.get()

            async with self.semaphore:
                task_id = task["task_id"]
                title = task["title"]
                article_id = task["article_id"]
                push_wechat = task.get("push_wechat", False)
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
                        snapshot["status"] = "completed"
                except Exception as e:
                    if snapshot is not None:
                        snapshot["result"] = {
                            "success": False,
                            "reason": f"处理异常: {e}"
                        }
                        snapshot["status"] = "failed"
                finally:
                    if snapshot is not None:
                        snapshot["finished_at"] = time.time()
                    if task_id in self.events:
                        self.events[task_id].set()

            self.queue.task_done()

    async def get_queue_size(self) -> int:
        return self.queue.qsize()

    async def get_status(self, task_id: str) -> Optional[Dict]:
        return self.results.get(task_id)
