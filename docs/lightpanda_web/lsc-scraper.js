import { chromium } from 'playwright-core';

const WS_URL = process.env.BROWSER_ADDRESS || 'ws://127.0.0.1:9222';
const TARGET_URL = 'https://www.lsc.org.cn/cns/html_pass/categoryList?id=1127&siteGroup=1';

const browser = await chromium.connectOverCDP(WS_URL);
const page = await browser.newPage();
await page.goto(TARGET_URL, { waitUntil: 'networkidle' });

const items = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.otherLi')).map(el => {
    const titleEl = el.querySelector('.rightTitle');
    const summaryEl = el.querySelector('.rightMsg');
    const dayEl = el.querySelector('.liDay');
    const monthEl = el.querySelector('.liMonth');
    const href = titleEl?.getAttribute('href') || '';
    const link = href.startsWith('http') ? href : 'https://www.lsc.org.cn/cns/html_pass/' + href.replace('./', '');
    return {
      title: titleEl?.textContent?.trim() || '',
      link,
      summary: summaryEl?.textContent?.trim() || '',
      date: (dayEl?.textContent?.trim() || '') + '-' + (monthEl?.textContent?.trim() || ''),
    };
  })
);

console.log(JSON.stringify(items, null, 2));
await browser.close();