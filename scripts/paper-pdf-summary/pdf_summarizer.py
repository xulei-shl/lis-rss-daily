#!/usr/bin/env python3
"""
PDF论文智能总结模块
功能：下载PDF、验证、生成AI总结、更新系统、上传知识库、创建备忘
并行执行：更新LIS-RSS + 上传知识库 + 创建Memos 三个任务并行
"""

import os
import sys
import json
import logging
import subprocess
import argparse
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass, asdict
from concurrent.futures import ProcessPoolExecutor, as_completed
import tempfile
import shutil

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent))

from config.settings import CONFIG, setup_logging
from utils.file_utils import ensure_dir, atomic_write_json, atomic_write_file
from utils.git_utils import check_git_lock, release_git_lock

logger = logging.getLogger(__name__)


@dataclass
class SummaryResult:
    """总结任务结果"""
    success: bool
    pdf_path: Optional[Path]
    md_path: Optional[Path]
    paper_info: Dict[str, Any]
    errors: list
    phase: str  # 记录失败的阶段

    def __post_init__(self):
        if self.errors is None:
            self.errors = []


class PDFSummarizer:
    """PDF论文总结器"""

    def __init__(self):
        self.download_script = Path(__file__).parent / "pdf-download" / "scholar_multi_download.py"
        self.summary_script = Path(__file__).parent / "pdf-summary" / "hiagent_summary.py"
        self.upload_script = Path(__file__).parent / "hiagent_upload.py"
        self.lis_rss_script = Path(__file__).parent / "summary-update" / "update_from_json.py"
        self.memos_script = Path(__file__).parent / "utils" / "create_memos.py"

        # 验证必要脚本
        self._validate_scripts()

    def _validate_scripts(self):
        """验证必要脚本是否存在"""
        required = {
            "download": self.download_script,
            "summary": self.summary_script,
            "upload": self.upload_script,
            "lis_rss": self.lis_rss_script,
        }
        for name, path in required.items():
            if not path.exists():
                raise FileNotFoundError(f"必要脚本缺失: {name} -> {path}")

    def download_pdf(self, paper_info: Dict[str, Any]) -> tuple[bool, Optional[Path], Optional[str]]:
        """
        步骤1: 下载PDF
        返回: (成功, pdf路径, 错误信息)
        """
        doi = paper_info.get("doi", "")
        title = paper_info.get("title", "")

        if not doi:
            logger.error("[步骤1-失败] 缺少DOI信息")
            return False, None, "缺少DOI信息"

        logger.info(f"[步骤1-开始] 下载PDF: {title[:50]}... (DOI: {doi})")

        # 创建临时下载目录
        temp_dir = Path(tempfile.mkdtemp(prefix="pdf_download_"))

        try:
            # 构建下载命令
            cmd = [
                sys.executable, str(self.download_script),
                "--doi", doi,
                "--title", title,
                "--output-dir", str(temp_dir)
            ]

            # 执行下载
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,  # 2分钟超时
                cwd=str(Path(__file__).parent)
            )

            if result.returncode != 0:
                error_msg = f"下载失败: {result.stderr.strip()}"
                logger.error(f"[步骤1-失败] {error_msg}")
                return False, None, error_msg

            # 查找下载的PDF
            pdf_files = list(temp_dir.glob("*.pdf"))
            if not pdf_files:
                error_msg = "下载完成但未找到PDF文件"
                logger.error(f"[步骤1-失败] {error_msg}")
                return False, None, error_msg

            pdf_path = pdf_files[0]
            logger.info(f"[步骤1-成功] PDF下载完成: {pdf_path.name}")
            return True, pdf_path, None

        except subprocess.TimeoutExpired:
            error_msg = "下载超时(2分钟)"
            logger.error(f"[步骤1-失败] {error_msg}")
            return False, None, error_msg
        except Exception as e:
            error_msg = f"下载异常: {str(e)}"
            logger.error(f"[步骤1-失败] {error_msg}")
            return False, None, error_msg
        finally:
            # 如果失败，清理临时目录
            if temp_dir.exists() and not (locals().get('pdf_files') if 'pdf_files' in locals() else False):
                shutil.rmtree(temp_dir, ignore_errors=True)

    def verify_pdf(self, pdf_path: Path) -> tuple[bool, Optional[str]]:
        """
        步骤2: 验证PDF
        返回: (成功, 错误信息)
        """
        logger.info(f"[步骤2-开始] 验证PDF: {pdf_path.name}")

        try:
            import fitz  # PyMuPDF

            doc = fitz.open(str(pdf_path))
            page_count = len(doc)
            doc.close()

            if page_count == 0:
                error_msg = "PDF文件为空（0页）"
                logger.error(f"[步骤2-失败] {error_msg}")
                return False, error_msg

            if page_count > 100:
                error_msg = f"PDF页数过多({page_count}页)，跳过"
                logger.warning(f"[步骤2-失败] {error_msg}")
                return False, error_msg

            # 检查文件大小
            file_size = pdf_path.stat().st_size / (1024 * 1024)  # MB
            if file_size > 50:
                error_msg = f"PDF文件过大({file_size:.1f}MB)，跳过"
                logger.warning(f"[步骤2-失败] {error_msg}")
                return False, error_msg

            logger.info(f"[步骤2-成功] PDF验证通过: {page_count}页, {file_size:.1f}MB")
            return True, None

        except Exception as e:
            error_msg = f"PDF验证失败: {str(e)}"
            logger.error(f"[步骤2-失败] {error_msg}")
            return False, error_msg

    def generate_summary(self, pdf_path: Path, paper_info: Dict[str, Any]) -> tuple[bool, Optional[Path], Optional[str]]:
        """
        步骤3: 生成AI总结
        返回: (成功, md路径, 错误信息)
        """
        title = paper_info.get("title", "")
        logger.info(f"[步骤3-开始] 生成AI总结: {title[:50]}...")

        try:
            # 步骤3a: 使用 HiAgent 生成总结
            cmd = [
                sys.executable, str(self.summary_script),
                "--pdf-path", str(pdf_path)
            ]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=180  # 3分钟超时
            )

            summary_text = ""

            if result.returncode == 0 and result.stdout:
                # 提取JSON输出
                try:
                    for line in result.stdout.split('\n'):
                        line = line.strip()
                        if line.startswith('{') and line.endswith('}'):
                            output_data = json.loads(line)
                            if output_data.get("status") == "success":
                                summary_text = output_data.get("summary", "")
                                logger.info("[步骤3a-成功] HiAgent平台总结完成")
                                break
                except json.JSONDecodeError:
                    pass

            # 如果HiAgent失败，使用本地Claude生成
            if not summary_text:
                logger.warning("[步骤3a-失败] HiAgent平台失败，回退到本地Claude")

                # 本地总结使用简单的prompt构建
                from skills.pdf_summary.hiagent_summary import process_pdf
                summary_text = process_pdf(str(pdf_path))

                if summary_text:
                    logger.info("[步骤3b-成功] 本地Claude总结完成")
                else:
                    error_msg = "本地总结也失败"
                    logger.error(f"[步骤3-失败] {error_msg}")
                    return False, None, error_msg

            # 步骤3c: 生成标准格式的 Markdown
            md_content = self._format_summary(paper_info, summary_text)
            md_path = CONFIG["paths"]["download_temp"] / f"{pdf_path.stem}.md"
            md_path.write_text(md_content, encoding="utf-8")

            logger.info(f"[步骤3-成功] MD文件已生成: {md_path}")
            return True, md_path, None

        except subprocess.TimeoutExpired:
            error_msg = "HiAgent总结超时(3分钟)"
            logger.error(f"[步骤3-失败] {error_msg}")
            return False, None, error_msg
        except Exception as e:
            error_msg = f"生成总结失败: {str(e)}"
            logger.error(f"[步骤3-失败] {error_msg}", exc_info=True)
            return False, None, error_msg

    def _format_summary(self, paper_info: Dict[str, Any], summary: str) -> str:
        """格式化总结为Markdown"""
        return f"""# {paper_info.get('title', '无标题')}

## 信息
- **DOI**: {paper_info.get('doi', 'N/A')}
- **作者**: {paper_info.get('authors', 'N/A')}
- **期刊**: {paper_info.get('journal', 'N/A')}
- **年份**: {paper_info.get('year', 'N/A')}

## AI总结

{summary}

---
*Generated by Claude Code*
"""

    def _upload_single_task(self, task_name: str, cmd: list, config: Dict[str, Any]) -> tuple[bool, str]:
        """
        执行单个上传任务的子进程
        这是静态方法，会被多进程调用
        """
        import subprocess
        import json

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5分钟超时
            )

            # 打印输出供父进程捕获
            print(f"[{task_name}] returncode: {result.returncode}")

            if result.returncode == 0:
                return True, f"{task_name}成功"
            else:
                return False, f"{task_name}失败: {result.stderr[:200]}"

        except subprocess.TimeoutExpired:
            return False, f"{task_name}超时(5分钟)"
        except Exception as e:
            return False, f"{task_name}异常: {str(e)}"

    def run_parallel_uploads(self, md_path: Path, paper_info: Dict[str, Any], pdf_path: Path) -> Dict[str, Any]:
        """
        步骤4: 并行执行上传任务
        - 更新LIS-RSS
        - 上传HiAgent知识库
        - 创建Memos备忘
        """
        logger.info(f"[步骤4-开始] 并行执行3个上传任务")

        results = {
            "lis_rss": {"success": False, "error": None},
            "hiagent": {"success": False, "error": None},
            "memos": {"success": False, "error": None},
        }

        # 准备配置
        md_content = md_path.read_text(encoding="utf-8")
        title = paper_info.get("title", "")

        # 任务1: 更新LIS-RSS
        rss_config = {
            "title": title,
            "doi": paper_info.get("doi", ""),
            "authors": paper_info.get("authors", ""),
            "journal": paper_info.get("journal", ""),
            "year": paper_info.get("year", ""),
            "ai_summary": md_content
        }

        # 任务2: 上传HiAgent
        upload_config = {
            "title": title,
            "doi": paper_info.get("doi", ""),
            "content": md_content,
            "doc_type": "system_review",
            "tags": ["自动上传", "文献总结"]
        }

        # 任务3: 创建Memos
        memo_config = {
            "title": f"[文献] {title}",
            "content": md_content
        }

        tasks = [
            ("lis_rss", self.lis_rss_script, {"title": title, "config": rss_config}),
            ("hiagent", self.upload_script, {"title": title, "config": upload_config}),
            ("memos", self.memos_script, {"title": title, "config": memo_config}),
        ]

        # 并行执行
        with ProcessPoolExecutor(max_workers=3) as executor:
            futures = {}

            for task_name, script_path, config in tasks:
                if task_name == "hiagent":
                    # 使用上传专用的上传脚本
                    cmd = [sys.executable, str(script_path), json.dumps(config)]
                else:
                    # 使用通用执行脚本
                    cmd = [
                        sys.executable, str(Path(__file__).parent / "utils" / "execute_task.py"),
                        "--task", task_name,
                        "--config", json.dumps(config)
                    ]

                future = executor.submit(self._execute_subprocess, task_name, cmd)
                futures[future] = task_name

            # 等待所有任务完成
            for future in as_completed(futures):
                task_name = futures[future]
                try:
                    success, error = future.result(timeout=6 * 60)  # 6分钟总超时
                    results[task_name]["success"] = success
                    results[task_name]["error"] = error

                    if success:
                        logger.info(f"[步骤4-{task_name}] 成功")
                    else:
                        logger.error(f"[步骤4-{task_name}] 失败: {error}")

                except Exception as e:
                    results[task_name]["error"] = f"执行异常: {str(e)}"
                    logger.error(f"[步骤4-{task_name}] 异常: {e}")

        return results

    def _execute_subprocess(self, task_name: str, cmd: list) -> tuple[bool, str]:
        """执行子进程并返回结果"""
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5分钟超时
            )

            if result.returncode == 0:
                return True, None
            else:
                return False, result.stderr[:500] if result.stderr else "未知错误"

        except subprocess.TimeoutExpired:
            return False, "超时(5分钟)"
        except Exception as e:
            return False, str(e)

    def cleanup(self, pdf_path: Optional[Path], md_path: Optional[Path]):
        """步骤5: 清理临时文件"""
        logger.info("[步骤5-开始] 清理临时文件")

        success = True
        pattern = []

        if pdf_path and pdf_path.exists():
            try:
                pdf_path.unlink()
                pattern.append(f"PDF({pdf_path.name})")
            except Exception as e:
                logger.error(f"删除PDF失败: {e}")
                success = False

        if md_path and md_path.exists():
            try:
                md_path.unlink()
                pattern.append(f"MD({md_path.name})")
            except Exception as e:
                logger.error(f"删除MD失败: {e}")
                success = False

        if success:
            logger.info(f"[步骤5-成功] 已清理: {', '.join(pattern)}")
        else:
            logger.warning("[步骤5-部分失败] 部分文件未清理")

    def process_paper(self, paper_info: Dict[str, Any]) -> SummaryResult:
        """
        处理单篇论文的完整流程
        """
        result = SummaryResult(
            success=False,
            pdf_path=None,
            md_path=None,
            paper_info=paper_info,
            errors=[],
            phase="initial"
        )

        try:
            # 步骤1: 下载PDF
            success, pdf_path, error = self.download_pdf(paper_info)
            if not success:
                result.errors.append(f"步骤1失败: {error}")
                result.phase = "download"
                return result
            result.pdf_path = pdf_path

            # 步骤2: 验证PDF
            success, error = self.verify_pdf(pdf_path)
            if not success:
                result.errors.append(f"步骤2失败: {error}")
                result.phase = "verify"
                # 继续执行，因为已经下载，尝试生成总结

            # 步骤3: 生成总结
            success, md_path, error = self.generate_summary(pdf_path, paper_info)
            if not success:
                result.errors.append(f"步骤3失败: {error}")
                result.phase = "summary"
                return result
            result.md_path = md_path

            # 步骤4: 并行上传
            upload_results = self.run_parallel_uploads(md_path, paper_info, pdf_path)

            # 检查上传结果
            all_upload_success = all(r["success"] for r in upload_results.values())
            any_upload_success = any(r["success"] for r in upload_results.values())

            if not any_upload_success:
                result.errors.append(f"步骤4完全失败: {upload_results}")
                result.phase = "upload"
                return result
            elif not all_upload_success:
                result.errors.append(f"步骤4部分失败: {upload_results}")
                # 继续执行，因为部分成功

            # 步骤5: 清理临时文件（仅在全部成功时）
            if all_upload_success:
                self.cleanup(pdf_path, md_path)

            result.success = all_upload_success
            result.phase = "complete"
            logger.info(f"✅ 论文处理完成: {paper_info.get('title', '无标题')[:50]}...")
            return result

        except Exception as e:
            logger.error(f"处理论文时发生异常: {e}", exc_info=True)
            result.errors.append(f"全局异常: {str(e)}")
            result.phase = "exception"
            return result

    def process_batch(self, papers: list[Dict[str, Any]], max_workers: int = 2) -> list[SummaryResult]:
        """
        批量处理论文
        """
        logger.info(f"开始批量处理 {len(papers)} 篇论文")

        results = []

        for i, paper in enumerate(papers, 1):
            logger.info(f"\n{'='*60}")
            logger.info(f"处理第 {i}/{len(papers)} 篇论文")
            logger.info(f"{'='*60}")

            result = self.process_paper(paper)
            results.append(result)

            # 每篇论文处理完后短暂休息
            if i < len(papers):
                import time
                time.sleep(2)

        # 统计结果
        success_count = sum(1 for r in results if r.success)
        logger.info(f"\n{'='*60}")
        logger.info(f"批量处理完成: {success_count}/{len(papers)} 成功")
        logger.info(f"{'='*60}")

        return results


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="PDF论文智能总结")
    parser.add_argument("--doi", help="论文DOI")
    parser.add_argument("--title", help="论文标题")
    parser.add_argument("--batch-file", help="批量处理JSON文件路径")
    parser.add_argument("--cleanup", action="store_true", help="处理完成后清理")

    args = parser.parse_args()

    # 初始化日志
    setup_logging()

    summarizer = PDFSummarizer()

    if args.batch_file:
        # 批量处理
        batch_file = Path(args.batch_file)
        if not batch_file.exists():
            logger.error(f"批量文件不存在: {batch_file}")
            sys.exit(1)

        papers = json.loads(batch_file.read_text(encoding="utf-8"))
        results = summarizer.process_batch(papers)

        # 生成报告
        success_count = sum(1 for r in results if r.success)
        print(f"\n{'='*60}")
        print(f"处理完成: {success_count}/{len(results)} 成功")
        print(f"{'='*60}")

        for i, result in enumerate(results, 1):
            status = "✅" if result.success else "❌"
            title = result.paper_info.get('title', '未知')[:40]
            print(f"{status} [{i}] {title}... ({result.phase})")

    elif args.doi and args.title:
        # 单篇处理
        paper_info = {
            "doi": args.doi,
            "title": args.title,
            "authors": "",
            "year": "",
            "journal": ""
        }

        result = summarizer.process_paper(paper_info)

        if result.success:
            print(f"\n✅ 处理成功!")
            print(f"   PDF: {result.pdf_path}")
            print(f"   MD: {result.md_path}")
        else:
            print(f"\n❌ 处理失败!")
            print(f"   失败阶段: {result.phase}")
            for error in result.errors:
                print(f"   - {error}")

    else:
        print("用法示例:")
        print("  python pdf_summarizer.py --doi 10.xxxx/xxxxx --title \"论文标题\"")
        print("  python pdf_summarizer.py --batch-file papers.json")


if __name__ == "__main__":
    main()
