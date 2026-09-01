import os, json, sys
from playwright.sync_api import sync_playwright

browser_address = os.environ.get("BROWSER_ADDRESS", "ws://127.0.0.1:9222")
target_url = "https://www.lsc.org.cn/cns/html_pass/categoryList?id=1127&siteGroup=1"

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

    print(json.dumps(items, ensure_ascii=False, indent=2))
    page.close()
    browser.close()
