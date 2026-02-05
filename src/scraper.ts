/**
 * Web scraper: Playwright + defuddle for content extraction.
 * Simplified version for RSS project (Twitter/X support removed).
 */

import playwright from 'playwright';
import { Defuddle } from 'defuddle/node';
import { toSimpleMarkdown } from './utils/markdown.js';

export interface ScrapeResult {
  url: string;
  og: {
    title?: string;
    description?: string;
    image?: string;
    siteName?: string;
    type?: string;
  };
  title?: string;
  author?: string;
  published?: string;
  markdown: string;
  rawHtml?: string;
}

/**
 * Scrape a URL: fetch with Playwright, extract OG metadata + article content as Markdown.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000); // Wait for JS rendering

    // Extract OpenGraph metadata + preprocessed HTML in a single evaluate call
    const { og, html } = await page.evaluate(`(() => {
      const getMeta = (prop) => {
        const el = document.querySelector('meta[property="' + prop + '"]') ||
          document.querySelector('meta[name="' + prop + '"]');
        return el ? el.getAttribute("content") : undefined;
      };

      const og = {
        title: getMeta("og:title") || document.title,
        description: getMeta("og:description") || getMeta("description"),
        image: getMeta("og:image"),
        siteName: getMeta("og:site_name"),
        type: getMeta("og:type"),
      };

      // Preprocess DOM
      document.querySelectorAll("script, style, link[rel='stylesheet']").forEach(el => el.remove());
      document.querySelectorAll("nav, footer, aside").forEach(el => el.remove());
      document.querySelectorAll("header").forEach(el => {
        if (!el.closest("article") && !el.closest("main")) el.remove();
      });
      document.querySelectorAll('[role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="search"]').forEach(el => el.remove());
      document.querySelectorAll('[class*="cookie-banner"], [id*="cookie-banner"], [class*="cookie-consent"], [class*="share-buttons"], [class*="social-share"], [class*="comment-section"], [id*="comments"]').forEach(el => el.remove());
      document.querySelectorAll('[hidden], [aria-hidden="true"]').forEach(el => el.remove());

      return { og, html: document.documentElement.outerHTML };
    })()`) as { og: ScrapeResult['og']; html: string };

    await browser.close();

    // Extract content with defuddle
    const _origLog = console.log;
    console.log = (msg: unknown, ...args: unknown[]) => {
      if (typeof msg === 'string' && msg.includes('Initial parse returned very little content'))
        return;
      _origLog(msg, ...args);
    };
    const result = await Defuddle(html, url);
    console.log = _origLog;

    // Convert HTML content to simple Markdown
    const markdown = toSimpleMarkdown(result.content || '');

    return {
      url,
      og,
      title: result.title || og.title,
      author: result.author || undefined,
      published: result.published || undefined,
      markdown,
    };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

