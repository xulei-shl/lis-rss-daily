/**
 * 处理流水线：分析 → 导出。
 *
 * 两阶段流程：
 * 1. 分析：生成摘要、关键词与翻译（LLM）
 * 2. 导出：导出 Markdown 文件（data/exports/）
 *
 * 包含重试与批处理机制。
 */

import { getDb } from './db.js';
import { analyzeArticle } from './agent.js';
import { exportArticleMarkdown, type ArticleForExport } from './export.js';
import { indexArticle } from './vector/indexer.js';
import {
  getArticleById,
  getArticleFilterMatchedKeywords,
  getArticleFilterMatches,
  upsertArticleKeywords,
  upsertArticleTranslation,
  updateArticleProcessStatus,
  refreshRelatedArticles,
  type ArticleWithSource,
} from './api/articles.js';
import { logger } from './logger.js';
import { toSimpleMarkdown } from './utils/markdown.js';

const log = logger.child({ module: 'pipeline' });

/* ── Public Types ── */

export interface ProcessResult {
  articleId: number;
  title: string;
  url: string;
  status: 'completed' | 'failed' | 'skipped';
  stage?: 'prepare' | 'analyze' | 'export';
  error?: string;
  duration?: number;
  reason?: string; // For skipped status
}

export interface ProcessOptions {
  maxConcurrent?: number;
  onProgress?: (articleId: number, stage: string) => void | Promise<void>;
}

export interface ProcessArticleOptions {
  /** 预留扩展 */
  reserved?: boolean;
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

/* ── Main Processing Functions ── */

/**
 * 单篇文章处理流程。
 *
 * 流程：
 * 1. 检查 filter_status（只处理 passed）
 * 2. 更新 process_status 为 processing
 * 3. 阶段1：准备 markdown_content
 * 4. 阶段2：分析（LLM 摘要 + 关键词 + 翻译）
 * 5. 阶段3：导出
 * 6. 更新 process_status 为 completed 或 failed
 *
 * @param articleId - 文章 ID
 * @param userId - 用户 ID
 * @returns 处理结果
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
    // 执行两阶段流程
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
 * 核心处理逻辑（两阶段）。
 */
async function runPipeline(
  articleId: number,
  article: ArticleWithSource,
  userId: number,
  options: ProcessArticleOptions
): Promise<Omit<ProcessResult, 'articleId' | 'title' | 'url' | 'duration'>> {
  const db = getDb();

  // ── Stage 1: Prepare markdown_content ──
  if (!article.markdown_content) {
    if (article.content) {
      const markdown = toSimpleMarkdown(article.content);
      await db
        .updateTable('articles')
        .set({
          markdown_content: markdown || null,
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', articleId)
        .execute();
      log.debug({ articleId }, '[stage1] Markdown generated from content');
    } else {
      const errMsg = 'No content available for analysis';
      await updateArticleProcessStatus(articleId, 'failed', errMsg);
      return { status: 'failed', stage: 'prepare', error: errMsg };
    }
  } else {
    log.debug({ articleId }, '[stage1] Markdown already exists');
  }

  // Re-fetch article to get markdown_content
  const updatedArticle = await getArticleById(articleId, userId);
  if (!updatedArticle?.markdown_content) {
    const errMsg = 'Failed to load markdown content';
    await updateArticleProcessStatus(articleId, 'failed', errMsg);
    return { status: 'failed', stage: 'prepare', error: errMsg };
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

    // 保存摘要
    if (analysisResult.summary) {
      await db
        .updateTable('articles')
        .set({
          summary: analysisResult.summary,
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', articleId)
        .execute();
    }

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

    const exportPath = await exportArticleMarkdown(articleForExport);
    indexArticle(articleId, userId).catch((error) => {
      log.warn({ articleId, error }, '[stage3] 向量索引失败');
    });

    log.info({ articleId, path: exportPath }, '[stage3] Export OK');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.warn({ articleId, error: errMsg }, '[stage3] Export failed (non-fatal)');
    // Export failure is not fatal - the article is still processed
  }

  // ── Stage 4: Related Articles (缓存计算，非致命) ──
  try {
    await refreshRelatedArticles(articleId, userId, 5);
    log.debug({ articleId }, '[stage4] Related articles updated');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.warn({ articleId, error: errMsg }, '[stage4] Related articles update failed (non-fatal)');
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
