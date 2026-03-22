import asyncio
import sys
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils.database import get_connection
from utils.pdf_downloader import load_config, create_download_directory, download_pdf
from utils.pdf_validator import validate_and_cleanup
from utils.pdf_summarizer import summarize_pdf
from utils.summary_uploader import upload_all as parallel_upload
from utils.logger import DailyLogger
import yaml


def load_workflow_config(config_path: str = "config/config.yaml") -> Dict:
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
            self._config = load_workflow_config()
        return self._config

    async def enqueue(self, title: str, article_id: Optional[int]) -> str:
        task_id = str(uuid.uuid4())
        self._ensure_worker()

        self.events[task_id] = asyncio.Event()
        self.results[task_id] = {
            "task_id": task_id,
            "title": title,
            "article_id": article_id,
            "status": "queued",
            "result": None
        }

        await self.queue.put({
            "task_id": task_id,
            "title": title,
            "article_id": article_id
        })

        return task_id

    async def get_result(self, task_id: str) -> Dict:
        if task_id not in self.events:
            return {"error": "Task not found"}

        await self.events[task_id].wait()

        result = self.results.pop(task_id)
        self.events.pop(task_id, None)

        return result.get("result", {"success": False, "reason": "Unknown error"})

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
        if 'wechat' not in skipped and upload_results.get('wechat', False):
            success_count += 1
        return success_count == 0

    async def _process_single_article(self, title: str, article_id: Optional[int]) -> Dict:
        article_id = article_id if article_id else 0
        skip_lis_rss = article_id == 0

        config = self._ensure_config()
        today = datetime.now().strftime("%Y-%m-%d")

        result = {
            "article_id": article_id,
            "title": title,
            "success": False,
            "stages": {}
        }

        download_root = config['storage']['download_root']
        daily_dir = create_download_directory(download_root, today)

        pdf_path = download_pdf(
            title=title,
            output_dir=str(daily_dir),
            config=config
        )

        if not pdf_path:
            result["reason"] = "PDF下载失败（所有脚本均失败）"
            return result

        result["stages"]["pdf_download"] = "success"

        threshold = config.get('pdf_download', {}).get('match_threshold', 0)
        matched, match_reason = validate_and_cleanup(
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

        md_path = summarize_pdf(pdf_path, config)

        if not md_path:
            result["stages"]["pdf_summary"] = "failed"
            result["reason"] = "PDF总结失败"
            return result

        result["stages"]["pdf_summary"] = "success"
        result["md_path"] = str(md_path)

        try:
            upload_results = await parallel_upload(
                md_path=str(md_path),
                article_id=article_id,
                article_title=title,
                source_name="API调用",
                config=config,
                skip_lis_rss=skip_lis_rss,
                skip_wechat=False
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

                self.results[task_id]["status"] = "running"

                try:
                    result = await self._process_single_article(title, article_id)
                    self.results[task_id]["result"] = result
                    self.results[task_id]["status"] = "completed"
                except Exception as e:
                    self.results[task_id]["result"] = {
                        "success": False,
                        "reason": f"处理异常: {e}"
                    }
                    self.results[task_id]["status"] = "failed"
                finally:
                    if task_id in self.events:
                        self.events[task_id].set()

            self.queue.task_done()

    async def get_queue_size(self) -> int:
        return self.queue.qsize()

    async def get_status(self, task_id: str) -> Optional[Dict]:
        return self.results.get(task_id)
