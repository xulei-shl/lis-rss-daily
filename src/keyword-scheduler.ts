/**
 * Keyword Scheduler Module
 *
 * 关键词订阅爬取调度器
 * - 每周六凌晨定时爬取关键词文章
 * - 支持手动触发爬取
 * - 多关键词错峰运行，避免触发反爬
 */

import { getActiveKeywords, crawlKeyword, type KeywordInfo } from './api/keywords.js';
import { logger } from './logger.js';
import { BaseScheduler } from './utils/base-scheduler.js';

const log = logger.child({ module: 'keyword-scheduler' });

/**
 * 调度器配置
 */
export interface KeywordSchedulerConfig {
  enabled: boolean;
  schedule: string;              // cron 表达式
  keywordInterval: number;       // 关键词间隔（毫秒）
  keywordIntervalRandom: number; // 随机化范围（毫秒）
  timeout: number;               // 单个爬虫超时（毫秒）
}

/**
 * 调度器状态
 */
export interface KeywordSchedulerStatus {
  isRunning: boolean;
  isScheduled: boolean;
  activeCrawls: number;
  completedCrawls: number;
  failedCrawls: number;
  totalArticlesFetched: number;
  lastRunTime?: Date;
}

/**
 * 关键词调度器类
 */
export class KeywordScheduler extends BaseScheduler {
  private static instance: KeywordScheduler | null = null;

  private config: KeywordSchedulerConfig;
  /** 单次爬取是否正在执行中（与 BaseScheduler.isRunning 区分） */
  private isExecuting = false;
  private activeCrawls: number = 0;
  private stats = {
    completedCrawls: 0,
    failedCrawls: 0,
    totalArticlesFetched: 0,
    lastRunTime: undefined as Date | undefined,
  };

  private constructor(config: KeywordSchedulerConfig) {
    super();
    this.config = config;
  }

  /* ── BaseScheduler overrides ── */

  get schedulerName(): string { return 'Keyword scheduler'; }
  get cronSchedule(): string { return this.config.schedule; }
  get isEnabled(): boolean { return this.config.enabled; }

  /**
   * Wait for active crawls to finish (up to 60s)
   */
  protected async waitForCompletion(): Promise<void> {
    const maxWaitTime = 60000;
    const startTime = Date.now();
    while (this.activeCrawls > 0 && Date.now() - startTime < maxWaitTime) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (this.activeCrawls > 0) {
      log.warn({ activeCrawls: this.activeCrawls }, 'Some crawls did not complete in time');
    }
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: KeywordSchedulerConfig): KeywordScheduler {
    if (!KeywordScheduler.instance) {
      if (!config) {
        throw new Error('KeywordScheduler config required on first initialization');
      }
      KeywordScheduler.instance = new KeywordScheduler(config);
    }
    return KeywordScheduler.instance;
  }

  /**
   * BaseScheduler.run() — 定时爬取入口
   */
  protected async run(): Promise<void> {
    if (this.isExecuting) {
      log.warn('Scheduled crawl already in progress, skipping');
      return;
    }

    this.isExecuting = true;
    this.stats.lastRunTime = new Date();

    try {
      const keywords = await getActiveKeywords(1);

      if (keywords.length === 0) {
        log.info('No active keywords to crawl');
        return;
      }

      log.info({ count: keywords.length }, 'Starting scheduled keyword crawl');

      for (let i = 0; i < keywords.length; i++) {
        const kw = keywords[i];

        // 计算间隔时间（错峰运行）
        if (i > 0) {
          const interval = this.config.keywordInterval +
            Math.random() * this.config.keywordIntervalRandom;

          log.info({
            keyword: kw.keyword,
            interval: Math.round(interval / 1000),
          }, 'Waiting before next crawl');

          await sleep(interval);
        }

        // 爬取单个关键词
        await this.crawlKeywordInternal(kw);
      }

      log.info({
        completed: this.stats.completedCrawls,
        failed: this.stats.failedCrawls,
        totalArticles: this.stats.totalArticlesFetched,
      }, 'Scheduled crawl completed');
    } catch (error) {
      log.error({ error }, 'Scheduled crawl failed');
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * 爬取单个关键词（内部方法）
   */
  private async crawlKeywordInternal(keyword: KeywordInfo): Promise<void> {
    this.activeCrawls++;

    try {
      log.info({
        keywordId: keyword.id,
        keyword: keyword.keyword,
      }, 'Starting keyword crawl');

      const result = await crawlKeyword(keyword.id);

      if (result.success) {
        this.stats.completedCrawls++;
        this.stats.totalArticlesFetched += result.articlesCount;
        log.info({
          keywordId: keyword.id,
          keyword: keyword.keyword,
          articlesCount: result.articlesCount,
          newArticlesCount: result.newArticlesCount,
        }, 'Keyword crawl completed');
      } else {
        this.stats.failedCrawls++;
        log.error({
          keywordId: keyword.id,
          keyword: keyword.keyword,
          error: result.error,
        }, 'Keyword crawl failed');
      }
    } catch (error) {
      this.stats.failedCrawls++;
      log.error({
        keywordId: keyword.id,
        keyword: keyword.keyword,
        error: error instanceof Error ? error.message : String(error),
      }, 'Keyword crawl error');
    } finally {
      this.activeCrawls--;
    }
  }

  /**
   * 手动触发单个关键词爬取
   */
  async crawlKeywordNow(keywordId: number): Promise<{
    success: boolean;
    articlesCount: number;
    newArticlesCount: number;
    error?: string;
  }> {
    try {
      const result = await crawlKeyword(keywordId);

      if (result.success) {
        this.stats.completedCrawls++;
        this.stats.totalArticlesFetched += result.articlesCount;
      } else {
        this.stats.failedCrawls++;
      }

      return result;
    } catch (error) {
      this.stats.failedCrawls++;
      return {
        success: false,
        articlesCount: 0,
        newArticlesCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 获取调度器状态
   */
  getStatus(): KeywordSchedulerStatus {
    return {
      isRunning: this.isRunning,
      isScheduled: true,  // Backward compat: cron is active when start() has been called
      activeCrawls: this.activeCrawls,
      completedCrawls: this.stats.completedCrawls,
      failedCrawls: this.stats.failedCrawls,
      totalArticlesFetched: this.stats.totalArticlesFetched,
      lastRunTime: this.stats.lastRunTime,
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      completedCrawls: 0,
      failedCrawls: 0,
      totalArticlesFetched: 0,
      lastRunTime: undefined,
    };
    log.info('Scheduler stats reset');
  }
}

/**
 * 延迟函数
 */
import { sleep } from './utils/sleep.js';

/**
 * 初始化关键词调度器
 */
export function initKeywordScheduler(): KeywordScheduler {
  const config: KeywordSchedulerConfig = {
    enabled: process.env.KEYWORD_CRAWL_ENABLED !== 'false',
    schedule: process.env.KEYWORD_CRAWL_SCHEDULE || '15 3 * * 6', // 每周六凌晨 3:15
    keywordInterval: parseInt(process.env.KEYWORD_INTERVAL || '300000', 10), // 5 分钟
    keywordIntervalRandom: parseInt(process.env.KEYWORD_INTERVAL_RANDOM || '30000', 10), // 30 秒
    timeout: parseInt(process.env.SPIDER_TIMEOUT || '430000', 10), // 7 分 10 秒
  };

  return KeywordScheduler.getInstance(config);
}
