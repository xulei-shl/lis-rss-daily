/**
 * Export: Generate Markdown documents from article records.
 *
 * Phase 6: Basic Markdown export to data/exports/.
 * Phase 8: QMD indexing integration.
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
  keywords?: string[];
  translation?: {
    title_zh?: string;
    summary_zh?: string;
    source_lang?: string;
  };
  filter_matches?: Array<{
    domainName: string | null;
    matchedKeywords: string[];
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

  const keywords = Array.isArray(article.keywords)
    ? article.keywords
    : safeParse<string[]>(article.keywords as any, []);

  // YAML front matter
  lines.push('---');
  lines.push(`id: ${article.id}`);
  lines.push(`url: "${article.url}"`);
  if (article.title) lines.push(`title: "${escapeFm(article.title)}"`);
  if (article.rss_source_name) lines.push(`source: "${escapeFm(article.rss_source_name)}"`);
  if (article.published_at) lines.push(`published: "${article.published_at}"`);
  if (article.created_at) lines.push(`created: "${article.created_at}"`);
  if (keywords.length > 0) lines.push(`tags: [${keywords.map((t) => `"${t}"`).join(', ')}]`);
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

  // 关键词
  if (keywords.length > 0) {
    lines.push('## 关键词');
    lines.push('');
    lines.push(keywords.map((k) => `- ${k}`).join('\n'));
    lines.push('');
  }

  // 过滤匹配
  if (article.filter_matches && article.filter_matches.length > 0) {
    lines.push('## 过滤匹配');
    lines.push('');
    for (const match of article.filter_matches) {
      const name = match.domainName ? `【${match.domainName}】` : '【未归类】';
      const kw = match.matchedKeywords.length > 0 ? `关键词：${match.matchedKeywords.join('、')}` : '关键词：无';
      const reason = match.filterReason ? `原因：${match.filterReason}` : '';
      lines.push(`- ${name} ${kw}${reason ? `；${reason}` : ''}`);
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

  // Phase 8: Link to QMD collection and trigger index update
  if (process.env.QMD_ENABLED !== 'false') {
    try {
      const { linkFileToQmdCollection } = await import('./qmd.js');
      linkFileToQmdCollection(filename);

      // Fire-and-forget: Request QMD index update (non-blocking)
      qmdIndexQueue.requestUpdate().catch((err) => {
        log.warn({ error: err }, 'QMD index update request failed');
      });
    } catch (error) {
      log.debug({ error }, 'QMD integration skipped (not available)');
    }
  }

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

/* ── Utility: Safe JSON Parse ── */

function safeParse<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/* ── QMD Integration (Phase 8) ── */

/**
 * QMD Index Queue: Serializes `qmd update` + `qmd embed` calls.
 * Multiple concurrent requests are coalesced - if an update is already running,
 * pending requests merge into a single follow-up run.
 *
 * This prevents SQLITE_BUSY errors and reduces redundant indexing operations.
 */
class QmdIndexQueue {
  private running = false;
  private pendingCount = 0;
  private log = logger.child({ module: 'qmd-queue' });

  /**
   * Request a QMD index update. If one is already running, the request is
   * queued and coalesced. Fire-and-forget safe - never rejects.
   */
  async requestUpdate(): Promise<void> {
    if (this.running) {
      this.pendingCount++;
      this.log.debug({ pendingCount: this.pendingCount }, 'Queued (already running)');
      return;
    }

    this.running = true;
    try {
      await this.runUpdate();

      // Run again for coalesced requests
      while (this.pendingCount > 0) {
        this.pendingCount = 0;
        this.log.info('Running again for coalesced requests');
        await this.runUpdate();
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Execute qmd update followed by qmd embed.
   * Both commands are required for full indexing:
   * - qmd update: Index new/modified files
   * - qmd embed: Generate vector embeddings for semantic search
   */
  private async runUpdate(): Promise<void> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      this.log.info('Running qmd update...');
      const { stdout: updateOut } = await execAsync('qmd update', {
        encoding: 'utf-8',
        timeout: 60000,
      });
      this.log.info({ output: updateOut.trim() }, 'qmd update done');

      this.log.info('Running qmd embed...');
      const { stdout: embedOut } = await execAsync('qmd embed', {
        encoding: 'utf-8',
        timeout: 120000,
      });
      this.log.info({ output: embedOut.trim() }, 'qmd embed done');
    } catch (err) {
      this.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        'QMD indexing failed'
      );
    }
  }
}

export const qmdIndexQueue = new QmdIndexQueue();
