#!/usr/bin/env python3
"""
中图学会 网站爬虫脚本

用法:
  python lsc-scraper.py

环境变量:
  TARGET_URL        - 目标页面 URL（必选，如未提供则使用默认 URL 并报错）
  BROWSER_ADDRESS   - Playwright browser WebSocket 地址（默认 ws://127.0.0.1:9222）

输出: JSON 数组到 stdout，每个元素包含:
  - title:   文章标题
  - link:    文章链接
  - summary: 文章摘要
  - date:    日期（DD-MM 格式）
"""

import os, json, sys
from playwright.sync_api import sync_playwright

browser_address = os.environ.get("BROWSER_ADDRESS", "ws://127.0.0.1:9222")
target_url = os.environ.get("TARGET_URL", "")

if not target_url:
    print(json.dumps({"success": False, "error": "TARGET_URL environment variable is required"}, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)

try:
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(browser_address)
        page = browser.new_page()
        page.goto(target_url, wait_until="networkidle")

        items = page.eval_on_selector_all(
            ".otherLi",
            """els => els.map(el => {
                const titleEl = el.querySelector('.rightTitle');
                const summaryEl = el.querySelector('.rightMsg');
                const dayEl = el.querySelector('.liDay');
                const monthEl = el.querySelector('.liMonth');

                const href = titleEl?.getAttribute('href') || '';
                const link = href.startsWith('http')
                    ? href
                    : 'https://www.lsc.org.cn/cns/html_pass/' + href.replace('./', '');

                return {
                    title: titleEl?.textContent?.trim() || '',
                    link,
                    summary: summaryEl?.textContent?.trim() || '',
                    date: (dayEl?.textContent?.trim() || '') + '-' + (monthEl?.textContent?.trim() || ''),
                };
            })""",
        )

        print(json.dumps(items, ensure_ascii=False))
        page.close()
        browser.close()

        if not items:
            sys.exit(0)
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
    sys.exit(1)
