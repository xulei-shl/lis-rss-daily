/**
 * Web Scraper Scheduler
 *
 * Periodically fetches articles from web scraper sources.
 * Each source runs sequentially with random delays between sources.
 */

import { getDb } from './db.js';
import { logger } from './logger.js';
import { config } from './config.js';
import { BaseScheduler } from './utils/base-scheduler.js';
import { runWebScraper, parseScrapedDate } from './spiders/web-scraper-runner.js';
import { filterArticle, type FilterInput } from './filter.js';
import { processArticle } from './pipeline.js';
import { generateNormalizedTitle } from './utils/title.js';
import {
  getActiveWebSources,
  getWebSourceById,
  updateWebSourceLastFetched,
  createWebFetchLog,
  type WebSourceRecord,
} from './api/web-sources.js';

const log = logger.child({ module: 'web-scheduler' });

/**
 * Web 爬取源抓取结果封装
 */
interface WebFetchResult {
  success: boolean;
  sourceName: string;
  articlesCount: number;
  newArticlesCount: number;
  durationMs: number;
  error?: string;
}

/**
 * 调度器状态
 */
export interface WebSchedulerStatus {
  isRunning: boolean;
  activeFetches: number;
  completedFetches: number;
  failedFetches: number;
  totalArticlesFetched: number;
}

/**
 * Web 爬取调度器类
 */
export class WebScheduler extends BaseScheduler {
  private static instance: WebScheduler | null = null;
  private activeFetches: number = 0;
  private stats = {
    completedFetches: 0,
    failedFetches: 0,
    totalArticlesFetched: 0,
  };

  private constructor() {
    super();
  }

  /* ── BaseScheduler overrides ── */

  get schedulerName(): string { return 'Web scraper scheduler'; }

  get cronSchedule(): string {
    return config.webFetchSchedule;
  }

  get isEnabled(): boolean {
    return config.webFetchEnabled;
  }

  static getInstance(): WebScheduler {
    if (!WebScheduler.instance) {
      WebScheduler.instance = new WebScheduler();
    }
    return WebScheduler.instance;
  }

  /**
   * BaseScheduler.run() — 定时抓取入口
   */
  protected async run(): Promise<void> {
    const runLog = log.child({ runId: `web-run-${Date.now()}` });
    runLog.info('Starting scheduled web scraper fetch');

    try {
      // 获取所有活跃 web 源（用户 ID = 1，单用户系统）
      const sources = await getActiveWebSources(1);
      runLog.info({ sourceCount: sources.length }, 'Retrieved active web sources');

      if (sources.length === 0) {
        runLog.info('No active web sources to fetch');
        return;
      }

      // 串行执行（避免对目标网站造成过大压力）
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index];
        const result = await this.fetchSource(source);
        runLog.info(
          { name: source.name, success: result.success, newArticles: result.newArticlesCount },
          'Web source fetch completed'
        );

        // 源间随机延迟
        if (index < sources.length - 1) {
          const delay = 5000 + Math.random() * 10000; // 5-15 秒
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    } catch (error) {
      runLog.error({ error }, 'Scheduled web scraper fetch failed');
    }
  }

  /**
   * 手动触发抓取所有源
   */
  async fetchAllNow(): Promise<WebFetchResult[]> {
    const results: WebFetchResult[] = [];

    const sources = await getActiveWebSources(1);
    log.info({ sourceCount: sources.length }, 'Manual fetch all web sources');

    for (const source of sources) {
      const result = await this.fetchSource(source);
      results.push(result);
    }

    return results;
  }

  /**
   * 手动触发抓取单个源
   */
  async fetchSourceNow(sourceId: number): Promise<WebFetchResult> {
    const source = await getWebSourceById(sourceId, 1);
    if (!source) {
      return {
        success: false,
        sourceName: 'Unknown',
        articlesCount: 0,
        newArticlesCount: 0,
        durationMs: 0,
        error: 'Web source not found',
      };
    }

    return this.fetchSource(source, false);
  }

  /**
   * 抓取单个 web 源
   */
  private async fetchSource(source: WebSourceRecord, isScheduled: boolean = true): Promise<WebFetchResult> {
    const fetchLog = log.child({ sourceId: source.id, name: source.name, url: source.url });
    const startTime = Date.now();

    this.activeFetches++;

    try {
      fetchLog.info('Starting web source fetch');

      // 运行爬虫脚本
      const scraperResult = await runWebScraper(source.scraper_type, source.url);

      const durationMs = Date.now() - startTime;

      if (!scraperResult.success) {
        fetchLog.error({ error: scraperResult.error, durationMs }, 'Web scraper failed');

        // 记录失败日志
        await createWebFetchLog({
          webSourceId: source.id,
          status: 'failed',
          articlesCount: 0,
          newArticlesCount: 0,
          durationMs,
          isScheduled,
          errorMessage: scraperResult.error,
        });

        this.stats.failedFetches++;
        return {
          success: false,
          sourceName: source.name,
          articlesCount: 0,
          newArticlesCount: 0,
          durationMs,
          error: scraperResult.error,
        };
      }

      // 保存文章到数据库
      const { savedCount, newCount } = await this.saveArticles(source, scraperResult.articles);

      fetchLog.info(
        { articlesCount: scraperResult.articles.length, newCount, savedCount, durationMs },
        'Web source fetch completed'
      );

      // 更新 last_fetched_at
      await updateWebSourceLastFetched(source.id);

      // 记录成功日志
      const logStatus = newCount > 0 ? 'success' : (scraperResult.articles.length > 0 ? 'partial' : 'success');
      await createWebFetchLog({
        webSourceId: source.id,
        status: logStatus,
        articlesCount: scraperResult.articles.length,
        newArticlesCount: newCount,
        durationMs,
        isScheduled,
      });

      this.stats.completedFetches++;
      this.stats.totalArticlesFetched += newCount;

      return {
        success: true,
        sourceName: source.name,
        articlesCount: scraperResult.articles.length,
        newArticlesCount: newCount,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      fetchLog.error({ error: errorMessage, durationMs }, 'Web source fetch error');

      await createWebFetchLog({
        webSourceId: source.id,
        status: 'failed',
        articlesCount: 0,
        newArticlesCount: 0,
        durationMs,
        isScheduled,
        errorMessage,
      });

      this.stats.failedFetches++;
      return {
        success: false,
        sourceName: source.name,
        articlesCount: 0,
        newArticlesCount: 0,
        durationMs,
        error: errorMessage,
      };
    } finally {
      this.activeFetches--;
    }
  }

  /**
   * 保存文章到数据库
   */
  private async saveArticles(
    source: WebSourceRecord,
    articles: Array<{ title: string; link: string; summary?: string; date?: string }>
  ): Promise<{ savedCount: number; newCount: number }> {
    const db = getDb();
    let newCount = 0;
    const now = new Date().toISOString();

    for (const article of articles) {
      try {
        // 验证必填字段
        if (!article.title || !article.title.trim()) {
          log.warn({ link: article.link, sourceId: source.id }, 'Article missing title, skipping');
          continue;
        }
        if (!article.link || !article.link.trim()) {
          log.warn({ title: article.title, sourceId: source.id }, 'Article missing link, skipping');
          continue;
        }

        // 生成规范化标题用于去重
        const titleNormalized = generateNormalizedTitle(article.title);

        // 检查标题是否已存在（标题去重）
        if (titleNormalized) {
          const existing = await db
            .selectFrom('articles')
            .where('title_normalized', '=', titleNormalized)
            .select('id')
            .executeTakeFirst();

          if (existing) {
            log.debug(
              { title: article.title, link: article.link, existingId: existing.id, sourceId: source.id },
              'Article title already exists, skipping'
            );
            continue;
          }

          // Also check rejected_articles archive
          const rejectedExists = await db
            .selectFrom('rejected_articles')
            .where('title_normalized', '=', titleNormalized)
            .select('id')
            .executeTakeFirst();

          if (rejectedExists) {
            log.debug(
              { title: article.title, link: article.link, sourceId: source.id },
              'Article title exists in rejected_articles, skipping'
            );
            continue;
          }
        }

        // 检查 URL 是否已存在
        const urlExists = await db
          .selectFrom('articles')
          .where('url', '=', article.link.trim())
          .select('id')
          .executeTakeFirst();

        if (urlExists) {
          log.debug(
            { title: article.title, link: article.link, sourceId: source.id },
            'Article URL already exists, skipping'
          );
          continue;
        }

        // 解析日期
        const publishedAt = parseScrapedDate(article.date);

        // 插入新文章
        await db
          .insertInto('articles')
          .values({
            title: article.title.trim(),
            title_normalized: titleNormalized,
            url: article.link.trim(),
            summary: null,
            content: article.summary?.trim() || null,
            markdown_content: null,
            filter_status: 'pending',
            process_status: 'pending',
            source_origin: 'web',
            web_source_id: source.id,
            published_at: publishedAt ? new Date(publishedAt).toISOString() : null,
            is_read: 0,
            created_at: now,
            updated_at: now,
          })
          .execute();

        newCount++;
      } catch (error) {
        // 处理 UNIQUE 约束错误
        if (error && typeof error === 'object' && 'code' in error) {
          if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            log.debug(
              { title: article.title, link: article.link, sourceId: source.id },
              'Article already exists (URL or title), skipping'
            );
            continue;
          }
        }
        log.warn({
          title: article.title,
          link: article.link,
          error: error instanceof Error ? error.message : String(error),
          sourceId: source.id,
        }, 'Failed to save article');
      }
    }

    // 触发自动过滤
    if (newCount > 0) {
      this.triggerAutoFilter(source).catch((err) => {
        log.warn({ error: err, sourceId: source.id }, 'Auto-filter failed (non-critical)');
      });
    }

    return { savedCount: articles.length, newCount };
  }

  /**
   * 触发自动过滤
   */
  private async triggerAutoFilter(source: WebSourceRecord): Promise<void> {
    const db = getDb();

    // 获取该源未过滤的文章
    const dbArticles = await db
      .selectFrom('articles')
      .where('web_source_id', '=', source.id)
      .where('filter_status', '=', 'pending')
      .select([
        'id',
        'title',
        'content',
        'markdown_content',
        'url',
      ])
      .execute();

    if (dbArticles.length === 0) {
      log.info({ sourceId: source.id }, 'No pending articles for auto-filter');
      return;
    }

    log.info({ sourceId: source.id, name: source.name, count: dbArticles.length }, 'Starting auto-filter');

    let passedCount = 0;
    let rejectedCount = 0;

    for (const article of dbArticles) {
      try {
        const input: FilterInput = {
          articleId: article.id,
          userId: source.user_id,
          url: article.url,
          title: article.title,
          description: article.content || '',
          content: article.markdown_content || article.content || undefined,
          sourceType: source.source_type as any,
          sourceDomainId: source.domain_id,
        };

        const result = await filterArticle(input);

        if (result.passed) {
          passedCount++;
          // 触发后续处理
          processArticle(article.id, source.user_id)
            .then((res) => {
              log.debug({ articleId: article.id, status: res.status }, 'Auto process completed');
            })
            .catch((err) => {
              log.warn({ articleId: article.id, error: err?.message || String(err) }, 'Auto process failed');
            });
        } else {
          rejectedCount++;
          log.debug({ articleId: article.id, reason: result.filterReason }, 'Article rejected by filter');
        }
      } catch (error) {
        log.warn({ articleId: article.id, error }, 'Filter failed for article');
      }
    }

    log.info(
      { sourceId: source.id, total: dbArticles.length, passed: passedCount, rejected: rejectedCount },
      'Auto-filter completed'
    );
  }

  /**
   * 获取调度器状态
   */
  getStatus(): WebSchedulerStatus {
    return {
      isRunning: this.isRunning,
      activeFetches: this.activeFetches,
      completedFetches: this.stats.completedFetches,
      failedFetches: this.stats.failedFetches,
      totalArticlesFetched: this.stats.totalArticlesFetched,
    };
  }
}

/**
 * 初始化 Web 爬取调度器
 */
export function initWebScheduler(): WebScheduler {
  return WebScheduler.getInstance();
}
