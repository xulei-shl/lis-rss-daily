"""
工作流封装模块

封装 main.py 的调用逻辑，处理论文 PDF 摘要生成。
"""

import os
import sys
import json
import subprocess
import asyncio
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
from concurrent.futures import ThreadPoolExecutor


SCRIPT_DIR = Path(__file__).parent.parent
PYTHON_ENV = os.getenv("PYTHON_ENV", "/home/xulei/.pyenvs/env_camoufox/bin/python")


class WorkflowError(Exception):
    """工作流错误"""
    pass


class WorkflowResult:
    """工作流执行结果"""

    def __init__(
        self,
        success: bool,
        md_content: Optional[str] = None,
        md_path: Optional[str] = None,
        article_id: Optional[int] = None,
        error: Optional[str] = None,
        log_path: Optional[str] = None,
        telegram_sent: bool = False
    ):
        self.success = success
        self.md_content = md_content
        self.md_path = md_path
        self.article_id = article_id
        self.error = error
        self.log_path = log_path
        self.telegram_sent = telegram_sent


class Workflow:
    """论文 PDF 摘要工作流"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.logs_root = config.get("storage", {}).get("logs_root", "logs")
        self.download_root = config.get("storage", {}).get("download_root", "download")
        self._executor = ThreadPoolExecutor(max_workers=1)

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

    def _find_md_file(self, title: str) -> Optional[Path]:
        """查找生成的 MD 文件"""
        today = self._get_today()
        # 使用绝对路径
        download_root = Path(self.download_root)
        if not download_root.is_absolute():
            download_root = SCRIPT_DIR / download_root
        download_dir = download_root / today

        if not download_dir.exists():
            return None

        title_lower = title.lower()

        for md_file in download_dir.glob("*.md"):
            if title_lower[:20] in md_file.stem.lower():
                return md_file

        return None

    async def run(
        self,
        title: str,
        article_id: Optional[int] = None,
        skip_wechat: bool = True
    ) -> WorkflowResult:
        """
        执行工作流

        Args:
            title: 论文题名
            article_id: 文章 ID（可选）
            skip_wechat: 是否跳过企业微信推送

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
                skip_wechat
            )
            return result

        except Exception as e:
            return WorkflowResult(
                success=False,
                error=f"执行失败: {str(e)}"
            )

    def _run_sync(self, title: str, article_id: Optional[int], skip_wechat: bool = True) -> WorkflowResult:
        """
        同步执行工作流

        Args:
            title: 论文题名
            article_id: 文章 ID
            skip_wechat: 是否跳过企业微信推送

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

        try:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                env=env,
                cwd=str(SCRIPT_DIR)
            )

            stdout, _ = process.communicate(timeout=600)

            print(f"[Workflow] Process output:\n{stdout}")

            if process.returncode != 0:
                return WorkflowResult(
                    success=False,
                    error=f"脚本执行失败 (返回码: {process.returncode})"
                )

            # 解析JSON输出
            import json
            import re
            success_line = None
            for line in stdout.split('\n'):
                if 'SUMMARY_SUCCESS|' in line:
                    success_line = line.strip()
                    break
            
            if success_line:
                parts = success_line.split('|')
                if len(parts) >= 4:
                    md_path = parts[1]
                    article_id = int(parts[2]) if parts[2].isdigit() else None
                    title = parts[3]
                    
                    md_file = Path(md_path)
                    if md_file.exists():
                        md_content = md_file.read_text(encoding="utf-8")
                        
                        # 立即发送Telegram
                        from bot import TelegramBot
                        import yaml
                        
                        config = load_config()
                        bot = TelegramBot(
                            bot_token=config['telegram']['bot_token'],
                            user_id=config['telegram']['user_id'],
                            chat_id=config['telegram']['chat_id']
                        )
                        
                        asyncio.run(bot._send_message("✅ 处理完成！正在发送摘要..."))
                        max_length = 4000
                        if len(md_content) > max_length:
                            asyncio.run(bot._send_long_message(md_content))
                        else:
                            asyncio.run(bot._send_message("📄 **摘要内容**\n\n" + md_content))
                        asyncio.run(bot._send_message("✅ **处理完成**\n\n_摘要已生成并发送_"))
                        
                        # 后台执行步骤4
                        from threading import Thread
                        import sys
                        sys.path.insert(0, str(SCRIPT_DIR))
                        from utils.summary_uploader import upload_all
                        
                        def background_upload():
                            asyncio.run(upload_all(
                                md_path=md_path,
                                article_id=article_id,
                                article_title=title,
                                source_name='手动指定',
                                config=config,
                                skip_lis_rss=article_id is None,
                                skip_wechat=True
                            ))
                        
                        upload_thread = Thread(target=background_upload, daemon=True)
                        upload_thread.start()
                        
                        return WorkflowResult(
                            success=True,
                            md_content=None,
                            md_path=md_path,
                            article_id=article_id,
                            telegram_sent=True
                        )
            
            # 回退：尝试查找MD文件
            md_path = self._find_md_file(title)
            if md_path:
                md_content = md_path.read_text(encoding="utf-8")
                return WorkflowResult(
                    success=True,
                    md_content=md_content,
                    md_path=str(md_path),
                    article_id=article_id
                )
            else:
                return WorkflowResult(
                    success=False,
                    error="未找到生成的 MD 文件"
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
