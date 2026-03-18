import argparse
import asyncio
import sys
import pyperclip
from pathlib import Path

from playwright.async_api import async_playwright
import os
from dotenv import load_dotenv

load_dotenv()

URL = os.getenv("HIAGENT_PDF_URL")
ERROR_KEYWORDS = ["无法访问", "无法生成"]


async def main(pdf_path: str, md_path: str = None, headless: bool = True, delete_pdf: bool = True):
    print(f"\n{'='*60}")
    print(f"  HiAgent PDF 总结处理")
    print(f"{'='*60}")

    # 确保路径是 Path 对象，这样能更好地处理 Unicode 和特殊字符
    pdf_path_obj = Path(pdf_path)

    # 如果是相对路径，先检查当前目录
    if not pdf_path_obj.is_absolute():
        # 先尝试直接路径
        if not pdf_path_obj.exists():
            # 尝试在当前工作目录查找
            cwd_path = Path.cwd() / pdf_path_obj
            if cwd_path.exists():
                pdf_path_obj = cwd_path
            else:
                # 列出当前目录的 PDF 文件帮助用户诊断
                print(f"[错误] PDF文件不存在: {pdf_path}")
                pdf_files = list(Path.cwd().glob("*.pdf"))
                if pdf_files:
                    print("\n当前目录的 PDF 文件:")
                    for f in pdf_files[:10]:  # 只显示前10个
                        print(f"  {f.name}")
                    if len(pdf_files) > 10:
                        print(f"  ... 还有 {len(pdf_files) - 10} 个文件")
                sys.exit(1)

    if not pdf_path_obj.exists():
        print(f"[错误] PDF文件不存在: {pdf_path}")
        sys.exit(1)

    # 使用 resolve() 获取绝对路径，这比 os.path.abspath() 更可靠
    pdf_path = str(pdf_path_obj.resolve())
    pdf_size = pdf_path_obj.stat().st_size
    print(f"[1/7] PDF文件: {pdf_path}")
    print(f"[1/7] 文件大小: {pdf_size / 1024:.2f} KB")

    if md_path is None:
        md_path = str(pdf_path_obj.with_suffix(".md"))
    else:
        md_path = str(Path(md_path).resolve())

    print(f"[1/7] 输出MD: {md_path}")

    async with async_playwright() as p:
        print(f"\n[2/7] 启动浏览器 (headless={headless})...")
        browser = await p.chromium.launch(headless=headless)
        context = await browser.new_context()
        page = await context.new_page()

        print(f"[3/7] 打开 HiAgent 页面...")
        await page.goto(URL)
        await page.wait_for_load_state("networkidle")
        print(f"[3/7] 页面加载完成")

        agent_info_selector = ".agent-info-X_bxnfv.center"
        try:
            await page.wait_for_selector(agent_info_selector, timeout=3000)
            print(f"[3/7] 检测到已有会话")
        except Exception:
            print(f"[3/7] 未检测到已有会话，点击新增会话")
            new_chat_button = page.locator("button:has-text('新增会话')")
            await new_chat_button.click()
            await page.wait_for_load_state("networkidle")

        print(f"\n[4/7] 上传PDF文件...")
        upload_input = page.locator('input[type="file"]')
        await upload_input.set_input_files(pdf_path)
        await page.wait_for_timeout(1000)
        print(f"[4/7] 文件已选择")

        print(f"\n[5/7] 发送请求...")
        send_button = page.locator(".send-button-nkISIzC:not(.disabled-aewpicp)")
        await send_button.click()
        print(f"[5/7] 已发送，等待AI处理 (最长5分钟)...")

        print(f"\n[6/7] 等待处理完成...")
        copy_icon = page.locator("svg.hiagent-icon-copy-areality, svg.copy-icon").first
        await copy_icon.wait_for(state="visible", timeout=300000)
        print(f"[6/7] 处理完成，复制结果")

        # 先清空剪贴板，避免复制到旧内容
        pyperclip.copy('')
        await page.wait_for_timeout(500)

        # 点击复制按钮（将markdown格式内容复制到系统剪贴板）
        await copy_icon.click()
        await page.wait_for_timeout(1500)  # 给剪贴板操作更多时间

        # 从系统剪贴板读取markdown格式的内容
        result = pyperclip.paste()
        if not result:
            print(f"[警告] 剪贴板为空，尝试从DOM提取...")
            # 回退到DOM提取
            result = await page.evaluate("""
                () => {
                    const selectors = [
                        '.message-content',
                        '.markdown-body',
                        '[class*="message"][class*="content"]',
                        '.react-markdown',
                        '.prose'
                    ];

                    for (const selector of selectors) {
                        const element = document.querySelector(selector);
                        if (element) {
                            return element.innerText || element.textContent || '';
                        }
                    }
                    return '';
                }
            """)

        result_length = len(result)
        print(f"[6/7] 结果长度: {result_length} 字符")

        has_error = any(keyword in result for keyword in ERROR_KEYWORDS)
        if has_error:
            print(f"[错误] 检测到错误内容:")
            print(result)
            await browser.close()
            return result

        print(f"\n[7/7] 保存结果...")
        with open(md_path, "w", encoding="utf-8") as f:
            f.write(result)

        print(f"[7/7] 结果已保存: {md_path} ({result_length} 字符)")

        # 上传完成后删除原始 PDF 文件
        if delete_pdf:
            print(f"\n[清理] 删除原始PDF文件...")
            try:
                pdf_path_obj.unlink()
                print(f"[清理] 已删除: {pdf_path}")
            except Exception as e:
                print(f"[警告] 删除失败: {e}")
        else:
            print(f"\n[清理] 保留原始PDF文件")

        await browser.close()
        print(f"\n{'='*60}")
        print(f"  处理完成")
        print(f"{'='*60}")
        return result


if __name__ == "__main__":
    # 跨平台编码设置：确保确保 stdin/stdout/stderr 使用 UTF-8
    import io

    if sys.stdin.encoding.lower() != 'utf-8':
        sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
    if sys.stdout.encoding.lower() != 'utf-8':
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    if sys.stderr.encoding.lower() != 'utf-8':
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

    parser = argparse.ArgumentParser(description="HiAgent PDF处理脚本")
    parser.add_argument("pdf_path", help="PDF文件路径（必备）")
    parser.add_argument("--md", "-m", help="MD保存路径（可选，默认与PDF同目录同名）")
    parser.add_argument("--headed", action="store_true", help="有头模式（显示浏览器窗口，默认无头）")
    parser.add_argument("--delete", "-d", action="store_true", help="上传后删除本地 PDF 文件（默认保留）")
    parser.add_argument("--no-delete", action="store_true", help="上传后保留本地 PDF 文件（默认删除，此标志优先）")

    args = parser.parse_args()

    # --no-delete 优先级高于 --delete
    delete_pdf = args.delete and not args.no_delete

    print(f"[INFO] PDF路径: {args.pdf_path}")
    print(f"[INFO] 删除原PDF: {'是' if delete_pdf else '否'}")

    result = asyncio.run(main(args.pdf_path, args.md, headless=not args.headed, delete_pdf=delete_pdf))
