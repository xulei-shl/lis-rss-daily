"""
工作流封装模块

封装 main.py 的调用逻辑，处理论文 PDF 摘要生成。
"""

import os
import sys
import json
import subprocess
import asyncio
import re
import time as time_module
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, Tuple, Callable, List
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

# 添加 utils 目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
try:
    from summary_uploader import upload_all
except ImportError:
    upload_all = None


SCRIPT_DIR = Path(__file__).parent.parent
PYTHON_ENV = os.getenv("PYTHON_ENV", "/home/xlei/.pyenvs/env_camoufox/bin/python")

PROGRESS_STAGES = [
    (r"步骤1.*PDF下载", "PDF下载中..."),
    (r"尝试 \d+/\d+", "尝试下载方案..."),
    (r"下载成功|SUCCESS|✅", "PDF下载成功"),
    (r"PDF.*已下载|下载.*成功", "PDF下载成功"),
    (r"步骤2.*验证", "验证PDF文件名..."),
    (r"PDF验证通过", "PDF验证通过"),
    (r"步骤3.*总结|PDF总结", "正在生成摘要..."),
    (r"MD文件.*生成|总结成功", "摘要生成成功"),
]

class WorkflowError(Exception):
    """工作流错误"""
    pass


@dataclass
class WorkflowProgress:
    """工作流进度"""
    stage: str
    message: str
    timestamp: datetime = None
    
    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.now()


class WorkflowResult:
    """工作流执行结果"""

    def __init__(
        self,
        success: bool,
        md_content: Optional[str] = None,
        md_path: Optional[str] = None,
        article_id: Optional[int] = None,
        error: Optional[str] = None,
        log_path: Optional[str] = None
    ):
        self.success = success
        self.md_content = md_content
        self.md_path = md_path
        self.article_id = article_id
        self.error = error
        self.log_path = log_path


class Workflow:
    """论文 PDF 摘要工作流"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.logs_root = config.get("storage", {}).get("logs_root", "logs")
        self.download_root = config.get("storage", {}).get("download_root", "download")
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._progress_callbacks: List[Callable[[WorkflowProgress], None]] = []

    def add_progress_callback(self, callback: Callable[[WorkflowProgress], None]):
        """添加进度回调"""
        self._progress_callbacks.append(callback)

    def clear_progress_callbacks(self):
        """清空进度回调"""
        self._progress_callbacks.clear()

    def _emit_progress(self, stage: str, message: str):
        """触发进度通知"""
        progress = WorkflowProgress(stage=stage, message=message)
        for callback in self._progress_callbacks:
            try:
                callback(progress)
            except Exception as e:
                print(f"[Workflow] Progress callback error: {e}")

    def _get_today(self) -> str:
        """获取今日日期"""
        return datetime.now().strftime("%Y-%m-%d")

    def _get_log_file(self, date: str) -> Optional[Path]:
        """获取日志文件路径"""
        log_file = Path(self.logs_root) / f"{date}.json"
        if log_file.exists():
            return log_file
        return None

    def _read_log_content(self, date: str) -> Optional[Dict[str, Any]]:
        """读取日志内容"""
        log_file = self._get_log_file(date)
        if not log_file:
            return None

        try:
            return json.loads(log_file.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[Workflow] Failed to read log: {e}")
            return None

    def _find_latest_log(self) -> Optional[Dict[str, Any]]:
        """查找最新的日志"""
        today = self._get_today()

        for date in [today]:
            log_data = self._read_log_content(date)
            if log_data:
                return log_data

        return None


    async def run(
        self,
        title: str,
        article_id: Optional[int] = None,
        skip_wechat: bool = True,
        progress_callback: Optional[Callable[[WorkflowProgress], None]] = None
    ) -> WorkflowResult:
        """
        执行工作流

        Args:
            title: 论文题名
            article_id: 文章 ID（可选）
            skip_wechat: 是否跳过企业微信推送
            progress_callback: 进度回调函数

        Returns:
            WorkflowResult 结果对象
        """
        loop = asyncio.get_event_loop()

        try:
            result = await loop.run_in_executor(
                self._executor,
                self._run_sync,
                title,
                article_id,
                skip_wechat,
                progress_callback
            )
            return result

        except Exception as e:
            return WorkflowResult(
                success=False,
                error=f"执行失败: {str(e)}"
            )

    def _run_sync(
        self, 
        title: str, 
        article_id: Optional[int], 
        skip_wechat: bool = True,
        progress_callback: Optional[Callable[[WorkflowProgress], None]] = None
    ) -> WorkflowResult:
        """
        同步执行工作流

        Args:
            title: 论文题名
            article_id: 文章 ID
            skip_wechat: 是否跳过企业微信推送
            progress_callback: 进度回调函数

        Returns:
            WorkflowResult 结果对象
        """
        cmd = [
            "/usr/bin/xvfb-run", "-a",
            PYTHON_ENV,
            str(SCRIPT_DIR / "main.py"),
            "--title", title,
            "--stop-after-summary"
        ]

        if article_id is not None:
            cmd.extend(["--id", str(article_id)])

        if skip_wechat:
            cmd.append("--skip-wechat")

        print(f"[Workflow] Running command: {' '.join(cmd)}")

        env = os.environ.copy()
        env["PYTHONPATH"] = str(SCRIPT_DIR)

        last_stage = ""
        output_lines = []

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env=env,
                cwd=str(SCRIPT_DIR),
                bufsize=1
            )

            current_stage = "准备中"
            self._emit_progress("准备", f"开始处理: {title[:30]}...")

            while True:
                line = process.stdout.readline()
                if not line and process.poll() is not None:
                    break

                if line:
                    line = line.strip()
                    if line:
                        output_lines.append(line)
                        print(f"[Workflow] {line}")

                        for pattern, message in PROGRESS_STAGES:
                            if re.search(pattern, line, re.IGNORECASE):
                                if current_stage != message:
                                    current_stage = message
                                    self._emit_progress("处理中", message)
                                    if progress_callback:
                                        progress_callback(WorkflowProgress(stage="处理中", message=message))
                                break

            stdout = "\n".join(output_lines)
            process.wait()

            print(f"[Workflow] Process return code: {process.returncode}")

            if process.returncode != 0:
                return WorkflowResult(
                    success=False,
                    error=f"脚本执行失败 (返回码: {process.returncode})"
                )

            # 从输出中解析 hiagent_upload.py 输出的 JSON
            md_path_from_json = None
            for line in output_lines:
                try:
                    data = json.loads(line.strip())
                    if data.get('status') == 'success' and data.get('md_path'):
                        md_path_from_json = data['md_path']
                        break
                except json.JSONDecodeError:
                    pass

            if md_path_from_json:
                self._emit_progress("完成", "处理成功！")

                md_content = ""
                if Path(md_path_from_json).exists():
                    md_content = Path(md_path_from_json).read_text(encoding="utf-8")

                return WorkflowResult(
                    success=True,
                    md_content=md_content,
                    md_path=md_path_from_json,
                    article_id=article_id,
                    error=None
                )
            else:
                return WorkflowResult(
                    success=False,
                    error="未从输出中解析到 MD 文件路径"
                )

        except subprocess.TimeoutExpired:
            process.kill()
            return WorkflowResult(
                success=False,
                error="执行超时（超过10分钟）"
            )

        except Exception as e:
            return WorkflowResult(
                success=False,
                error=f"执行异常: {str(e)}"
            )

    def get_error_from_log(self, title: str) -> Optional[str]:
        """从日志中获取错误信息"""
        log_data = self._find_latest_log()
        if not log_data:
            return None

        failures = log_data.get("failures", [])
        title_lower = title.lower()

        for failure in failures:
            failure_title = failure.get("title", "").lower()
            if title_lower[:30] in failure_title:
                return failure.get("reason")

        return None


def load_config(config_path: str = "config/config.yaml") -> Dict[str, Any]:
    """加载配置"""
    import yaml

    config_path = Path(config_path)
    if not config_path.exists():
        raise WorkflowError(f"配置文件不存在: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


async def upload_summary_async(
    md_path: str,
    article_id: Optional[int],
    title: str,
    config: Dict[str, Any]
) -> Dict[str, bool]:
    """
    异步上传摘要到各子系统

    这个函数应该在推送给用户摘要后，在后台执行。

    Args:
        md_path: MD 文件路径
        article_id: 文章 ID（可选）
        title: 文章标题
        config: 配置字典

    Returns:
        各子系统上传结果字典
    """
    if upload_all is None:
        print("[Workflow] upload_all not available, skipping upload")
        return {}

    try:
        print(f"[Workflow] Starting background upload: {md_path}")
        results = await upload_all(
            md_path=md_path,
            article_id=article_id or 0,
            article_title=title,
            config=config,
            source_name=None,
            skip_lis_rss=(article_id is None),
            skip_wechat=True
        )
        print(f"[Workflow] Upload completed: {results}")
        return results
    except Exception as e:
        print(f"[Workflow] Upload error: {e}")
        return {"error": str(e)}
