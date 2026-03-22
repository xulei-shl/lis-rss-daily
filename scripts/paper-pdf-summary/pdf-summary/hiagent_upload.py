import argparse
import asyncio
import sys
import json
import pyperclip
from pathlib import Path

from playwright.async_api import async_playwright
import os
from dotenv import load_dotenv

load_dotenv()

URL = os.getenv("HIAGENT_PDF_URL")
ERROR_KEYWORDS = ["无法访问", "无法生成"]
RESULT_SELECTORS = [
    '.message-content',
    '.markdown-body',
    '[class*="message"][class*="content"]',
    '.react-markdown',
    '.prose'
]


async def main(pdf_path: str, md_path: str = None, headless: bool = True, delete_pdf: bool = True):
    result = None
    error_msg = None

    try:
        pdf_path_obj = Path(pdf_path)

        if not pdf_path_obj.is_absolute():
            if not pdf_path_obj.exists():
                cwd_path = Path.cwd() / pdf_path_obj
                if cwd_path.exists():
                    pdf_path_obj = cwd_path
                else:
                    error_msg = f"PDF文件不存在: {pdf_path}"
                    print(json.dumps({"status": "error", "message": error_msg}))
                    return

        if not pdf_path_obj.exists():
            error_msg = f"PDF文件不存在: {pdf_path}"
            print(json.dumps({"status": "error", "message": error_msg}))
            return

        pdf_path = str(pdf_path_obj.resolve())
        pdf_size = pdf_path_obj.stat().st_size

        if md_path is None:
            md_path = str(pdf_path_obj.with_suffix(".md"))
        else:
            md_path = str(Path(md_path).resolve())

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=headless)
            context = await browser.new_context()
            page = await context.new_page()

            await page.goto(URL)
            await page.wait_for_load_state("networkidle")

            agent_info_selector = ".agent-info-X_bxnfv.center"
            try:
                await page.wait_for_selector(agent_info_selector, timeout=3000)
            except Exception:
                new_chat_button = page.locator("button:has-text('新增会话')")
                await new_chat_button.click()
                await page.wait_for_load_state("networkidle")

            upload_input = page.locator('input[type="file"]')
            await upload_input.set_input_files(pdf_path)
            await page.wait_for_timeout(1000)

            send_button = page.locator(".send-button-nkISIzC:not(.disabled-aewpicp)")
            await send_button.click()

            copy_icon = page.locator("svg.hiagent-icon-copy-areality, svg.copy-icon").first
            await copy_icon.wait_for(state="visible", timeout=180000)

            result = ""
            for attempt in range(3):
                pyperclip.copy('')
                await page.wait_for_timeout(200)

                copy_icon = page.locator("svg.hiagent-icon-copy-areality.copy-icon").first
                await copy_icon.scroll_into_view_if_needed()
                await copy_icon.click()
                await page.wait_for_timeout(500)

                result = pyperclip.paste()
                if result and len(result) > 100:
                    break

            if not result or len(result) < 100:
                result = await page.evaluate(f"""
                    () => {{
                        const selectors = {json.dumps(RESULT_SELECTORS)};
                        for (const selector of selectors) {{
                            const element = document.querySelector(selector);
                            if (element) {{
                                return element.innerText || element.textContent || '';
                            }}
                        }}
                        return '';
                    }}
                """)

            result_length = len(result) if result else 0

            has_error = result and any(keyword in result for keyword in ERROR_KEYWORDS)
            if has_error:
                error_msg = "检测到错误内容"
                await browser.close()
                print(json.dumps({"status": "error", "message": error_msg}))
                return

            if result:
                with open(md_path, "w", encoding="utf-8") as f:
                    f.write(result)

            if delete_pdf:
                try:
                    pdf_path_obj.unlink()
                except Exception:
                    pass

            await browser.close()

            result_json = json.dumps({
                "status": "success",
                "md_path": md_path,
                "chars": result_length
            })
            print(result_json, flush=True)

    except asyncio.TimeoutError:
        print(json.dumps({
            "status": "error", 
            "message": "处理超时(5分钟)"
        }))
    except Exception as e:
        print(json.dumps({
            "status": "error", 
            "message": str(e)
        }))


if __name__ == "__main__":
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
    parser.add_argument("--delete", "-d", action="store_true", help="上传后删除本地 PDF 文件（默认删除）")
    parser.add_argument("--no-delete", action="store_true", help="上传后保留本地 PDF 文件")

    args = parser.parse_args()

    delete_pdf = args.delete and not args.no_delete

    asyncio.run(main(args.pdf_path, args.md, headless=not args.headed, delete_pdf=delete_pdf))