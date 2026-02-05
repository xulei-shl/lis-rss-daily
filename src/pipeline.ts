/**
 * Pipeline: Article processing workflow (scrape → analyze → export).
 *
 * Three-stage pipeline for processing RSS articles:
 * 1. Scrape: Fetch full article content using Playwright + Defuddle
 * 2. Analyze: 生成关键词与翻译（LLM）
 * 3. Export: Export to Markdown file (data/exports/)
 *
 * Includes retry mechanism with exponential backoff and batch processing.
 */

import { getDb } from './db.js';
import { scrapeUrl } from './scraper.js';
import { analyzeArticle } from './agent.js';
import { exportArticleMarkdown, type ArticleForExport } from './export.js';
import {
  getArticleById,
  getArticleFilterMatchedKeywords,
  getArticleFilterMatches,
  upsertArticleKeywords,
  upsertArticleTranslation,
  updateArticleProcessStatus,
  type ArticleWithSource,
} from './api/articles.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'pipeline' });

/* ── Public Types ── */

export interface ProcessResult {
  articleId: number;
  title: string;
  url: string;
  status: 'completed' | 'failed' | 'skipped';
  stage?: 'scrape' | 'analyze' | 'export';
  error?: string;
  duration?: number;
  reason?: string; // For skipped status
}

export interface ProcessOptions {
  maxConcurrent?: number;
  onProgress?: (articleId: number, stage: string) => void | Promise<void>;
}

export interface ProcessArticleOptions {
  /** 跳过抓取全文阶段，仅使用已有内容进行摘要 */
  skipScrape?: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  backoffMultiplier: number;
  maxDelay: number;
}

/* ── Configuration ── */

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: parseInt(process.env.ARTICLE_RETRY_MAX_RETRIES || '3', 10),
  baseDelay: parseInt(process.env.ARTICLE_RETRY_BASE_DELAY || '5000', 10),
  backoffMultiplier: parseFloat(process.env.ARTICLE_RETRY_BACKOFF_MULTIPLIER || '2'),
  maxDelay: parseInt(process.env.ARTICLE_RETRY_MAX_DELAY || '60000', 10),
};

const MAX_CONCURRENT = parseInt(process.env.ARTICLE_PROCESS_MAX_CONCURRENT || '3', 10);

const SCRAPE_REJECT_KEYWORDS = [
  '安全验证',
  '验证码',
  '请完成安全验证',
  '请依次点击',
  'robot',
  'captcha',
  'access denied',
  'forbidden',
  '验证后继续',
  '需要启用 javascript',
  'enable javascript',
  'are you human',
  '拒绝访问',
] as const;

/* ── Main Processing Functions ── */

/**
 * Process a single article through the full pipeline.
 *
 * Flow:
 * 1. Check filter_status (only 'passed' articles are processed)
 * 2. Update process_status to 'processing'
 * 3. Stage 1: Scrape (if no markdown_content)
 * 4. Stage 2: Analyze (LLM 关键词 + 翻译)
 * 5. Stage 3: Export (Markdown file)
 * 6. Update process_status to 'completed' or 'failed'
 *
 * @param articleId - Article ID to process
 * @param userId - User ID (for permission check)
 * @returns Process result with status and details
 */
export async function processArticle(
  articleId: number,
  userId: number,
  options: ProcessArticleOptions = {}
): Promise<ProcessResult> {
  const startTime = Date.now();

  // Get article and check filter status
  const article = await getArticleById(articleId, userId);
  if (!article) {
    return {
      articleId,
      title: 'Unknown',
      url: '',
      status: 'failed',
      error: 'Article not found',
    };
  }

  // Only process articles that passed the filter
  if (article.filter_status !== 'passed') {
    log.info(
      { articleId, title: article.title, filterStatus: article.filter_status },
      '[skip] Article filter status is not "passed"'
    );
    return {
      articleId,
      title: article.title,
      url: article.url,
      status: 'skipped',
      reason: `Filter status: ${article.filter_status}`,
    };
  }

  // Update status to processing
  await updateArticleProcessStatus(articleId, 'processing');

  log.info({ articleId, title: article.title }, '[start] Processing article');

  try {
    // Run the three-stage pipeline
    const result = await runPipeline(articleId, article, userId, options);
    const duration = Date.now() - startTime;

    log.info({ articleId, title: article.title, duration, status: result.status }, '[done] Processing complete');

    return {
      ...result,
      articleId,
      title: article.title,
      url: article.url,
      duration,
    };
  } catch (error) {
    // Handle any uncaught errors
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ articleId, title: article.title, error: errMsg }, '[error] Processing failed');

    await updateArticleProcessStatus(articleId, 'failed', errMsg);

    return {
      articleId,
      title: article.title,
      url: article.url,
      status: 'failed',
      error: errMsg,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Process multiple articles with concurrency control.
 *
 * @param articleIds - Array of article IDs to process
 * @param userId - User ID (for permission check)
 * @param options - Processing options (maxConcurrent, onProgress)
 * @returns Array of process results
 */
export async function processBatchArticles(
  articleIds: number[],
  userId: number,
  options?: ProcessOptions
): Promise<ProcessResult[]> {
  const maxConcurrent = options?.maxConcurrent ?? MAX_CONCURRENT;
  const results: ProcessResult[] = [];

  log.info({ count: articleIds.length, maxConcurrent }, '[batch] Starting batch process');

  // Process articles in batches
  for (let i = 0; i < articleIds.length; i += maxConcurrent) {
    const batch = articleIds.slice(i, i + maxConcurrent);

    const batchResults = await Promise.allSettled(
      batch.map((articleId) =>
        processArticle(articleId, userId)
          .then((result) => {
            options?.onProgress?.(articleId, result.stage || 'done');
            return result;
          })
          .catch((error) => {
            log.error({ articleId, error: error.message }, '[batch] Article processing failed');
            return {
              articleId,
              title: 'Unknown',
              url: '',
              status: 'failed' as const,
              error: error.message,
            };
          })
      )
    );

    // Collect results
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      }
    }
  }

  const completed = results.filter((r) => r.status === 'completed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  log.info({ total: results.length, completed, failed, skipped }, '[batch] Batch process complete');

  return results;
}

/**
 * Retry a failed article.
 *
 * Resets the process_status to 'pending' and re-runs the pipeline.
 *
 * @param articleId - Article ID to retry
 * @param userId - User ID (for permission check)
 * @returns Process result
 */
export async function retryFailedArticle(articleId: number, userId: number): Promise<ProcessResult> {
  const article = await getArticleById(articleId, userId);
  if (!article) {
    return {
      articleId,
      title: 'Unknown',
      url: '',
      status: 'failed',
      error: 'Article not found',
    };
  }

  log.info(
    { articleId, title: article.title, prevStatus: article.process_status },
    '[retry] Retrying failed article'
  );

  // Reset status to pending
  await updateArticleProcessStatus(articleId, 'processing');

  return processArticle(articleId, userId);
}

/* ── Internal Pipeline Logic ── */

/**
 * Core pipeline logic with three stages.
 */
async function runPipeline(
  articleId: number,
  article: ArticleWithSource,
  userId: number,
  options: ProcessArticleOptions
): Promise<Omit<ProcessResult, 'articleId' | 'title' | 'url' | 'duration'>> {
  const db = getDb();

  // ── Stage 1: Scrape (if needed) ──
  if (options.skipScrape) {
    // 跳过抓取阶段：使用已有内容作为 Markdown（保持 content 原样）
    if (!article.markdown_content) {
      if (article.content) {
        await db
          .updateTable('articles')
          .set({
            markdown_content: article.content,
            updated_at: new Date().toISOString(),
          })
          .where('id', '=', articleId)
          .execute();
      } else {
        const errMsg = 'Skip scrape enabled but no content available';
        await updateArticleProcessStatus(articleId, 'failed', errMsg);
        return { status: 'failed', stage: 'scrape', error: errMsg };
      }
    }
    log.debug({ articleId }, '[stage1] Scrape skipped (skipScrape=true)');
  } else if (!article.markdown_content) {
    try {
      log.debug({ articleId, url: article.url }, '[stage1] Starting scrape');

      const scrapeResult = await executeWithRetry(
        () => scrapeUrl(article.url),
        DEFAULT_RETRY_CONFIG,
        { articleId, stage: 'scrape' }
      );

      const scrapeMarkdown = (scrapeResult.markdown || '').trim();

      if (isScrapeContentUsable(scrapeMarkdown, article.content || undefined)) {
        // 保存抓取内容（仅在质量合格时覆盖）
        await db
          .updateTable('articles')
          .set({
            markdown_content: scrapeMarkdown,
            updated_at: new Date().toISOString(),
          })
          .where('id', '=', articleId)
          .execute();

        log.info({ articleId, chars: scrapeMarkdown.length }, '[stage1] Scrape OK');
      } else {
        log.warn({ articleId, chars: scrapeMarkdown.length }, '[stage1] Scrape rejected by quality guard');
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error({ articleId, error: errMsg }, '[stage1] Scrape failed');

      await updateArticleProcessStatus(articleId, 'failed', `[scrape] ${errMsg}`);

      return { status: 'failed', stage: 'scrape', error: errMsg };
    }
  } else {
    log.debug({ articleId }, '[stage1] Scrape skipped (already have content)');
  }

  // Re-fetch article to get markdown_content
  const updatedArticle = await getArticleById(articleId, userId);
  if (!updatedArticle?.markdown_content) {
    const errMsg = 'Failed to load markdown content after scrape';
    await updateArticleProcessStatus(articleId, 'failed', errMsg);
    return { status: 'failed', stage: 'scrape', error: errMsg };
  }

  // ── Stage 2: Analyze (LLM) ──
  let analysisResult;
  try {
    log.debug({ articleId }, '[stage2] Starting LLM analysis');

    const filterMatchedKeywords = await getArticleFilterMatchedKeywords(articleId, userId);

    analysisResult = await executeWithRetry(
      () =>
        analyzeArticle(
          {
            url: updatedArticle.url,
            title: updatedArticle.title,
            summary: updatedArticle.summary ?? undefined,
            markdown: updatedArticle.markdown_content ?? undefined,
          },
          userId,
          filterMatchedKeywords
        ),
      DEFAULT_RETRY_CONFIG,
      { articleId, stage: 'analyze' }
    );

    // Save keywords + translation
    await upsertArticleKeywords(articleId, userId, analysisResult.keywords);

    if (analysisResult.translation && (analysisResult.translation.titleZh || analysisResult.translation.summaryZh)) {
      await upsertArticleTranslation(articleId, userId, {
        title_zh: analysisResult.translation.titleZh ?? null,
        summary_zh: analysisResult.translation.summaryZh ?? null,
        source_lang: analysisResult.translation.sourceLang ?? null,
      });
    }

    log.info(
      { articleId, keywords: analysisResult.keywords.length, usedFallback: analysisResult.usedFallback },
      '[stage2] Analyze OK'
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ articleId, error: errMsg }, '[stage2] Analyze failed');

    await updateArticleProcessStatus(articleId, 'failed', `[analyze] ${errMsg}`);

    return { status: 'failed', stage: 'analyze', error: errMsg };
  }

  // ── Stage 3: Export ──
  try {
    log.debug({ articleId }, '[stage3] Starting export');

    const filterMatches = await getArticleFilterMatches(articleId, userId);

    // Prepare article for export with analysis results
    const articleForExport: ArticleForExport = {
      ...updatedArticle,
      keywords: analysisResult?.keywords,
      translation: analysisResult?.translation ?? undefined,
      filter_matches: filterMatches,
    };

    const exportPath = exportArticleMarkdown(articleForExport);

    log.info({ articleId, path: exportPath }, '[stage3] Export OK');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.warn({ articleId, error: errMsg }, '[stage3] Export failed (non-fatal)');
    // Export failure is not fatal - the article is still processed
  }

  // ── Complete ──
  await updateArticleProcessStatus(articleId, 'completed');

  return { status: 'completed' };
}

/* ── Retry Mechanism ── */

/**
 * Execute a function with retry and exponential backoff.
 *
 * @param fn - Function to execute
 * @param config - Retry configuration
 * @param context - Context for logging (articleId, stage)
 * @returns Function result
 * @throws Last error if all retries exhausted
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  context: { articleId: number; stage: string }
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === config.maxRetries) {
        break; // Max retries reached
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
        config.maxDelay
      );

      log.warn(
        {
          articleId: context.articleId,
          stage: context.stage,
          attempt: attempt + 1,
          maxRetries: config.maxRetries + 1,
          delay,
          error: lastError.message,
        },
        '[retry] Retrying after error'
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Sleep for a specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断抓取内容是否可用（避免反爬/验证码页覆盖 RSS 正文）
 */
function isScrapeContentUsable(scrapeMarkdown: string, rssContent?: string): boolean {
  if (!scrapeMarkdown) return false;

  const lower = scrapeMarkdown.toLowerCase();
  for (const keyword of SCRAPE_REJECT_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) return false;
  }

  // 太短的内容通常无效
  const minLen = 200;
  if (scrapeMarkdown.length < minLen) return false;

  if (rssContent) {
    // 抓取内容明显短于 RSS 内容时不覆盖
    const ratio = scrapeMarkdown.length / Math.max(rssContent.length, 1);
    if (ratio < 0.6) return false;
  }

  return true;
}

/* ── Utility Functions ── */

/**
 * Get pending articles for processing.
 *
 * @param userId - User ID
 * @param limit - Maximum number of articles to return
 * @returns Array of pending article IDs
 */
export async function getPendingArticleIds(userId: number, limit: number = 50): Promise<number[]> {
  const db = getDb();

  const articles = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.process_status', '=', 'pending')
    .select('articles.id')
    .orderBy('articles.created_at', 'desc')
    .limit(limit)
    .execute();

  return articles.map((a) => a.id);
}

/**
 * Get failed articles for retry.
 *
 * @param userId - User ID
 * @param limit - Maximum number of articles to return
 * @returns Array of failed article IDs
 */
export async function getFailedArticleIds(userId: number, limit: number = 50): Promise<number[]> {
  const db = getDb();

  const articles = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.process_status', '=', 'failed')
    .select('articles.id')
    .orderBy('articles.updated_at', 'desc')
    .limit(limit)
    .execute();

  return articles.map((a) => a.id);
}
