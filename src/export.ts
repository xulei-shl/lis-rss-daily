/**
 * Export: Generate Markdown documents from article records.
 *
 * Phase 6: Basic Markdown export to data/exports/.
 * Phase 8: 向量索引由 pipeline 统一触发。
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import type { ArticlesTable } from './db.js';

const log = logger.child({ module: 'export' });

// Export directory from environment variable or default to data/exports/
const EXPORT_DIR = process.env.ARTICLE_EXPORT_DIR || path.join(process.cwd(), 'data', 'exports');

/**
 * Article record type for export (extends ArticlesTable with optional extra fields).
 */
export interface ArticleForExport extends ArticlesTable {
  rss_source_name?: string;
  translation?: {
    title_zh?: string;
    summary_zh?: string;
    source_lang?: string;
  };
  filter_matches?: Array<{
    domainName: string | null;
    filterReason: string | null;
  }>;
}

/* ── Utility Functions ── */

/**
 * Generate a URL-safe slug from a title string.
 * Supports Chinese characters.
 */
function slugify(text: string, maxLen: number = 60): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, '')  // Keep word chars, spaces, and Chinese
    .replace(/[\s_]+/g, '-')                  // Replace spaces/underscores with hyphens
    .replace(/^-+|-+$/g, '')                  // Trim leading/trailing hyphens
    .slice(0, maxLen);
}

/**
 * Escape YAML front matter values.
 */
function escapeFm(s: string): string {
  return s.replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Build the Markdown filename for an article.
 * Format: {articleId}-{slug}.md
 */
function buildFilename(article: ArticleForExport): string {
  const title = article.title || new URL(article.url).hostname;
  const slug = slugify(title) || 'untitled';
  return `${article.id}-${slug}.md`;
}

/* ── Export Functions ── */

/**
 * Render an article as a Markdown document.
 *
 * Template structure:
 * --- YAML front matter ---
 * # Title
 * > URL
 * **Description**
 * ## 摘要
 * ## 原文
 */
function renderMarkdown(article: ArticleForExport): string {
  const lines: string[] = [];

  // YAML front matter
  lines.push('---');
  lines.push(`id: ${article.id}`);
  lines.push(`url: "${article.url}"`);
  if (article.title) lines.push(`title: "${escapeFm(article.title)}"`);
  if (article.rss_source_name) lines.push(`source: "${escapeFm(article.rss_source_name)}"`);
  if (article.published_at) lines.push(`published: "${article.published_at}"`);
  if (article.created_at) lines.push(`created: "${article.created_at}"`);
  lines.push('---');
  lines.push('');

  // Title
  lines.push(`# ${article.title || article.url}`);
  lines.push('');

  // RSS Summary
  if (article.summary) {
    lines.push('## RSS 摘要');
    lines.push('');
    lines.push(article.summary);
    lines.push('');
  }

  // 中文翻译
  const translation = article.translation;
  if (translation && (translation.title_zh || translation.summary_zh)) {
    lines.push('## 中文翻译');
    lines.push('');
    if (translation.title_zh) {
      lines.push(`**标题译文:** ${translation.title_zh}`);
    }
    if (translation.summary_zh) {
      if (translation.title_zh) lines.push('');
      lines.push(`**摘要译文:** ${translation.summary_zh}`);
    }
    lines.push('');
  }

  // 过滤匹配
  if (article.filter_matches && article.filter_matches.length > 0) {
    lines.push('## 过滤匹配');
    lines.push('');
    for (const match of article.filter_matches) {
      const name = match.domainName ? `【${match.domainName}】` : '【未归类】';
      const reason = match.filterReason ? `原因：${match.filterReason}` : '';
      lines.push(`- ${name}${reason ? ` ${reason}` : ''}`);
    }
    lines.push('');
  }

  // Full original content (scraped markdown)
  if (article.markdown_content) {
    lines.push('## 原文');
    lines.push('');
    lines.push(article.markdown_content);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Export a single article to a Markdown file.
 *
 * @param article - Article record with all necessary fields
 * @returns File path of the exported Markdown file
 */
export async function exportArticleMarkdown(article: ArticleForExport): Promise<string> {
  // Ensure export directory exists
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const filename = buildFilename(article);
  const filepath = path.join(EXPORT_DIR, filename);
  const content = renderMarkdown(article);

  fs.writeFileSync(filepath, content, 'utf-8');
  log.info({ path: filepath, articleId: article.id }, 'Article exported');

  return filepath;
}

/**
 * Delete the exported Markdown file for an article.
 *
 * @param articleId - Article ID
 * @param title - Article title (for filename generation, optional)
 * @returns true if a file was deleted, false if not found
 */
export function deleteArticleExport(articleId: number, title?: string): boolean {
  const slug = title ? slugify(title) : '';
  const filename = slug ? `${articleId}-${slug}.md` : `${articleId}-*.md`;
  const filepath = path.join(EXPORT_DIR, filename);

  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    log.info({ path: filepath, articleId }, 'Export deleted');
    return true;
  }

  // Try wildcard pattern if slug-based filename didn't work
  if (slug) {
    const dir = fs.readdirSync(EXPORT_DIR);
    const match = dir.find((f) => f.startsWith(`${articleId}-`));
    if (match) {
      const matchPath = path.join(EXPORT_DIR, match);
      fs.unlinkSync(matchPath);
      log.info({ path: matchPath, articleId }, 'Export deleted (wildcard match)');
      return true;
    }
  }

  return false;
}

/**
 * Export multiple articles to Markdown files.
 *
 * @param articles - Array of article records
 * @returns Array of exported file paths
 */
export async function exportBatchArticles(articles: ArticleForExport[]): Promise<string[]> {
  const paths: string[] = [];
  for (const article of articles) {
    if (article.process_status === 'completed' && article.id) {
      paths.push(await exportArticleMarkdown(article));
    }
  }
  log.info({ count: paths.length, dir: EXPORT_DIR }, 'Batch export completed');
  return paths;
}

