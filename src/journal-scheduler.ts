/**
 * Journal Scheduler Module
 *
 * 期刊爬取调度器
 * - 每周六晚上定时爬取期刊文章
 * - 支持手动触发爬取
 * - 与 RSS 调度器互斥运行
 */

import cron from 'node-cron';
import { getDb } from './db.js';
import { logger } from './logger.js';
import { pythonSpiderRunner } from './spiders/index.js';
import {
  getActiveJournals,
  updateJournalCrawlStatus,
  createCrawlLog,
  calculateIssuesToCrawl,
} from './api/journals.js';
import { filterArticle, type FilterInput } from './filter.js';
import { processArticle } from './pipeline.js';
import type { JournalInfo, CrawlResult, SpiderResult, CrawledArticle } from './spiders/types.js';

const log = logger.child({ module: 'journal-scheduler' });

/**
 * 调度器配置
 */
export interface JournalSchedulerConfig {
  enabled: boolean;
  schedule: string;           // cron 表达式
  journalInterval: number;    // 期刊间隔（毫秒）
  journalIntervalRandom: number;  // 随机化范围（毫秒）
  timeout: number;            // 单个爬虫超时（毫秒）
}

/**
 * 调度器状态
 */
export interface JournalSchedulerStatus {
  isRunning: boolean;
  activeCrawls: number;
  completedCrawls: number;
  failedCrawls: number;
  totalArticlesFetched: number;
  lastRunTime?: Date;
  nextRunTime?: Date;
}

/**
 * 期刊调度器类
 */
export class JournalScheduler {
  private static instance: JournalScheduler | null = null;

  private scheduledTask: cron.ScheduledTask | null = null;
  private config: JournalSchedulerConfig;
  private isRunning: boolean = false;
  private activeCrawls: number = 0;
  private stats = {
    completedCrawls: 0,
    failedCrawls: 0,
    totalArticlesFetched: 0,
    lastRunTime: undefined as Date | undefined,
  };

  private constructor(config: JournalSchedulerConfig) {
    this.config = config;
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: JournalSchedulerConfig): JournalScheduler {
    if (!JournalScheduler.instance) {
      if (!config) {
        throw new Error('JournalScheduler config required on first initialization');
      }
      JournalScheduler.instance = new JournalScheduler(config);
    }
    return JournalScheduler.instance;
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      log.warn('Journal scheduler already running');
      return;
    }

    if (!this.config.enabled) {
      log.info('Journal scheduler disabled in config');
      return;
    }

    try {
      // 验证 cron 表达式
      if (!cron.validate(this.config.schedule)) {
        throw new Error(`Invalid cron expression: ${this.config.schedule}`);
      }

      // 创建定时任务
      this.scheduledTask = cron.schedule(
        this.config.schedule,
        () => {
          this.runScheduledCrawl().catch((err) => {
            log.error({ err }, 'Scheduled crawl error');
          });
        },
        {
          scheduled: false,
          timezone: 'Asia/Shanghai',
        }
      );

      this.scheduledTask.start();
      this.isRunning = true;

      log.info(
        {
          schedule: this.config.schedule,
        },
        'Journal scheduler started'
      );
    } catch (error) {
      log.error({ error }, 'Failed to start journal scheduler');
      throw error;
    }
  }

  /**
   * 停止调度器
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    log.info('Stopping journal scheduler...');

    // 停止定时任务
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }

    // 等待活跃爬取完成
    const maxWaitTime = 60000; // 60 秒
    const startTime = Date.now();

    while (this.activeCrawls > 0 && Date.now() - startTime < maxWaitTime) {
      log.debug({ activeCrawls: this.activeCrawls }, 'Waiting for active crawls to complete');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (this.activeCrawls > 0) {
      log.warn({ activeCrawls: this.activeCrawls }, 'Forced shutdown with active crawls');
    }

    this.isRunning = false;
    log.info('Journal scheduler stopped');
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<JournalSchedulerConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasRunning && this.config.enabled) {
      this.start();
    }

    log.info({ config: this.config }, 'Journal scheduler config updated');
  }

  /**
   * 定时爬取入口
   */
  private async runScheduledCrawl(): Promise<void> {
    const runId = `run-${Date.now()}`;
    const runLog = log.child({ runId });

    runLog.info('Starting scheduled journal crawl');

    try {
      // 获取所有活跃期刊（用户 ID = 1，单用户系统）
      const journals = await getActiveJournals(1);
      runLog.info({ journalCount: journals.length }, 'Retrieved active journals');

      if (journals.length === 0) {
        runLog.info('No active journals to crawl');
        return;
      }

      // 获取当前日期
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      // 执行爬取
      const results: CrawlResult[] = [];

      for (const journal of journals) {
        // 计算需要爬取的期号
        const issuesToCrawl = calculateIssuesToCrawl(journal, currentYear, currentMonth);

        if (issuesToCrawl.length === 0) {
          runLog.debug({ journalId: journal.id, name: journal.name }, 'No new issues to crawl');
          continue;
        }

        runLog.info(
          { journalId: journal.id, name: journal.name, issues: issuesToCrawl },
          'Crawling journal issues'
        );

        // 爬取每个期号
        for (const issueInfo of issuesToCrawl) {
          const result = await this.crawlJournal(journal, issueInfo.year, issueInfo.issue, issueInfo.volume);
          results.push(result);

          // 期刊间隔
          if (results.length < journals.length) {
            const delay = this.getRandomDelay(
              this.config.journalInterval,
              this.config.journalIntervalRandom
            );
            runLog.debug({ delay }, 'Waiting before next journal');
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      // 统计
      const successCount = results.filter((r) => r.success).length;
      const totalArticles = results.reduce((sum, r) => sum + r.articlesCount, 0);
      const newArticles = results.reduce((sum, r) => sum + r.newArticlesCount, 0);

      runLog.info(
        {
          totalCrawls: results.length,
          successCount,
          failedCount: results.length - successCount,
          totalArticles,
          newArticles,
        },
        'Scheduled crawl completed'
      );

      // 更新统计
      this.stats.lastRunTime = new Date();
      this.stats.completedCrawls += successCount;
      this.stats.failedCrawls += results.length - successCount;
      this.stats.totalArticlesFetched += totalArticles;
    } catch (error) {
      runLog.error({ error }, 'Scheduled crawl failed');
    }
  }

  /**
   * 爬取单个期刊
   */
  async crawlJournal(
    journal: JournalInfo,
    year: number,
    issue: number,
    volume?: number
  ): Promise<CrawlResult> {
    const crawlLog = log.child({ journalId: journal.id, year, issue });
    const startTime = Date.now();

    this.activeCrawls++;

    try {
      crawlLog.info({ name: journal.name }, 'Starting journal crawl');

      // 运行 Python 爬虫
      const spiderResult = await pythonSpiderRunner.runSpider(journal.source_type, {
        url: journal.source_url || undefined,
        code: journal.journal_code || undefined,
        year,
        issue,
        volume,
      });

      const duration = Date.now() - startTime;

      if (!spiderResult.success) {
        crawlLog.error({ error: spiderResult.error, duration }, 'Spider failed');

        // 记录失败日志
        await createCrawlLog({
          journalId: journal.id,
          year,
          issue,
          volume,
          articlesCount: 0,
          newArticlesCount: 0,
          status: 'failed',
          errorMessage: spiderResult.error,
          durationMs: duration,
        });

        return {
          success: false,
          journalId: journal.id,
          year,
          issue,
          volume,
          articlesCount: 0,
          newArticlesCount: 0,
          durationMs: duration,
          error: spiderResult.error,
        };
      }

      // 保存文章到数据库
      const { savedCount, newCount } = await this.saveArticles(journal.id, spiderResult.articles);

      crawlLog.info(
        { articlesCount: spiderResult.articles.length, newCount, duration },
        'Journal crawl completed'
      );

      // 更新期刊爬取状态
      await updateJournalCrawlStatus(journal.id, year, issue, volume);

      // 记录成功日志
      await createCrawlLog({
        journalId: journal.id,
        year,
        issue,
        volume,
        articlesCount: spiderResult.articles.length,
        newArticlesCount: newCount,
        status: 'success',
        durationMs: duration,
      });

      return {
        success: true,
        journalId: journal.id,
        year,
        issue,
        volume,
        articlesCount: spiderResult.articles.length,
        newArticlesCount: newCount,
        durationMs: duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      crawlLog.error({ error: errorMessage, duration }, 'Journal crawl error');

      // 记录失败日志
      await createCrawlLog({
        journalId: journal.id,
        year,
        issue,
        volume,
        articlesCount: 0,
        newArticlesCount: 0,
        status: 'failed',
        errorMessage,
        durationMs: duration,
      });

      return {
        success: false,
        journalId: journal.id,
        year,
        issue,
        volume,
        articlesCount: 0,
        newArticlesCount: 0,
        durationMs: duration,
        error: errorMessage,
      };
    } finally {
      this.activeCrawls--;
    }
  }

  /**
   * 保存文章到数据库
   */
  private async saveArticles(
    journalId: number,
    articles: CrawledArticle[]
  ): Promise<{ savedCount: number; newCount: number }> {
    const db = getDb();
    let newCount = 0;

    for (const article of articles) {
      try {
        // 检查文章是否已存在（通过 URL 去重）
        const existing = await db
          .selectFrom('articles')
          .where('url', '=', article.url)
          .select('id')
          .executeTakeFirst();

        if (existing) {
          continue;
        }

        // 插入新文章
        const now = new Date().toISOString();

        await db
          .insertInto('articles')
          .values({
            rss_source_id: null,
            title: article.title,
            url: article.url,
            summary: article.abstract || null,
            content: null,
            markdown_content: null,
            filter_status: 'pending',
            source_origin: 'journal',
            journal_id: journalId,
            created_at: now,
            updated_at: now,
          } as any)
          .execute();

        newCount++;
      } catch (error) {
        log.warn({ url: article.url, error }, 'Failed to save article');
      }
    }

    // 触发自动过滤
    if (newCount > 0) {
      this.triggerAutoFilter(journalId).catch((err) => {
        log.warn({ error: err, journalId }, 'Auto-filter failed (non-critical)');
      });
    }

    return { savedCount: articles.length, newCount };
  }

  /**
   * 触发自动过滤
   */
  private async triggerAutoFilter(journalId: number): Promise<void> {
    const db = getDb();

    // 获取该期刊未过滤的文章
    const articles = await db
      .selectFrom('articles')
      .where('journal_id', '=', journalId)
      .where('filter_status', '=', 'pending')
      .select(['id', 'title', 'summary', 'url'])
      .execute();

    log.info({ journalId, count: articles.length }, 'Starting auto-filter for journal articles');

    let passedCount = 0;

    for (const article of articles) {
      try {
        const input: FilterInput = {
          articleId: article.id,
          userId: 1, // 单用户系统
          url: article.url,
          title: article.title,
          description: article.summary || '',
          sourceType: 'journal',
        };

        const result = await filterArticle(input);

        if (result.passed) {
          passedCount++;
          // 触发后续处理
          processArticle(article.id, 1)
            .then((res) => {
              log.debug({ articleId: article.id, status: res.status }, 'Auto process completed');
            })
            .catch((err) => {
              log.warn({ articleId: article.id, error: err?.message || String(err) }, 'Auto process failed');
            });
        }
      } catch (error) {
        log.warn({ articleId: article.id, error }, 'Filter failed for article');
      }
    }

    log.info({ journalId, total: articles.length, passed: passedCount }, 'Auto-filter completed');
  }

  /**
   * 获取随机延迟
   */
  private getRandomDelay(base: number, random: number): number {
    const offset = Math.random() * random * 2 - random;
    return Math.max(0, base + offset);
  }

  /**
   * 获取调度器状态
   */
  getStatus(): JournalSchedulerStatus {
    const nextRun = this.isRunning ? new Date(Date.now() + 60000) : undefined;

    return {
      isRunning: this.isRunning,
      activeCrawls: this.activeCrawls,
      completedCrawls: this.stats.completedCrawls,
      failedCrawls: this.stats.failedCrawls,
      totalArticlesFetched: this.stats.totalArticlesFetched,
      lastRunTime: this.stats.lastRunTime,
      nextRunTime: nextRun,
    };
  }

  /**
   * 手动触发爬取单个期刊
   */
  async crawlNow(journalId: number, year?: number, issue?: number): Promise<CrawlResult> {
    const db = getDb();

    // 获取期刊信息
    const journal = await db
      .selectFrom('journals')
      .where('id', '=', journalId)
      .selectAll()
      .executeTakeFirst();

    if (!journal) {
      throw new Error('Journal not found');
    }

    const journalInfo: JournalInfo = {
      id: journal.id,
      name: journal.name,
      source_type: journal.source_type as any,
      source_url: journal.source_url,
      journal_code: journal.journal_code,
      publication_cycle: journal.publication_cycle as any,
      issues_per_year: journal.issues_per_year,
      volume_offset: journal.volume_offset,
      last_year: journal.last_year,
      last_issue: journal.last_issue,
      last_volume: journal.last_volume,
    };

    // 如果没有指定年/期，使用当前最新期
    const now = new Date();
    const crawlYear = year || now.getFullYear();
    const crawlIssue = issue || this.estimateCurrentIssue(journalInfo, now.getMonth() + 1);
    const crawlVolume = journal.source_type === 'lis' ? crawlYear - journal.volume_offset : undefined;

    return this.crawlJournal(journalInfo, crawlYear, crawlIssue, crawlVolume);
  }

  /**
   * 估算当前期号
   */
  private estimateCurrentIssue(journal: JournalInfo, currentMonth: number): number {
    switch (journal.publication_cycle) {
      case 'monthly':
        return currentMonth;
      case 'bimonthly':
        return Math.ceil(currentMonth / 2);
      case 'semimonthly':
        return currentMonth * 2;
      case 'quarterly':
        return Math.ceil(currentMonth / 3);
      default:
        return Math.ceil((currentMonth / 12) * journal.issues_per_year);
    }
  }
}

/**
 * 初始化期刊调度器
 */
export function initJournalScheduler(): JournalScheduler {
  const config: JournalSchedulerConfig = {
    enabled: process.env.JOURNAL_CRAWL_ENABLED !== 'false',
    schedule: process.env.JOURNAL_CRAWL_SCHEDULE || '0 20 * * 6', // 每周六晚上 20:00
    journalInterval: parseInt(process.env.JOURNAL_INTERVAL || '180000', 10), // 3 分钟
    journalIntervalRandom: parseInt(process.env.JOURNAL_INTERVAL_RANDOM || '30000', 10), // 30 秒
    timeout: parseInt(process.env.SPIDER_TIMEOUT || '300000', 10), // 5 分钟
  };

  return JournalScheduler.getInstance(config);
}
