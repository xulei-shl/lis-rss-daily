/**
 * RSS Scheduler Module
 *
 * Scheduled RSS feed fetching with node-cron.
 * Features:
 * - Concurrent fetch control
 * - Retry with exponential backoff
 * - Incremental fetching based on last_fetched_at
 * - Manual trigger support
 * - Graceful shutdown
 */

import cron from 'node-cron';
import { getDb } from './db.js';
import { getRSSParser, type RSSFeedItem } from './rss-parser.js';
import { logger } from './logger.js';
import { getActiveRSSSourcesForFetch } from './api/rss-sources.js';
import { saveArticles, checkArticlesExistByTitle } from './api/articles.js';
import { filterArticle, type FilterInput } from './filter.js';

const log = logger.child({ module: 'rss-scheduler' });

/**
 * Task status enumeration
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

/**
 * Fetch task representation
 */
export interface FetchTask {
  rssSourceId: number;
  userId: number;
  url: string;
  name: string;
  status: TaskStatus;
  retryCount: number;
  lastError?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Fetch result
 */
export interface FetchResult {
  rssSourceId: number;
  success: boolean;
  articlesCount: number;
  newArticlesCount: number;
  error?: string;
  duration: number;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  enabled: boolean;
  schedule: string;
  maxConcurrent: number;
  fetchTimeout: number;
  maxRetries: number;
  retryDelay: number;
  retryBackoffMultiplier: number;
}

/**
 * Scheduler status
 */
export interface SchedulerStatus {
  isRunning: boolean;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalArticlesFetched: number;
  lastRunTime?: Date;
  nextRunTime?: Date;
}

/**
 * RSS Scheduler class
 *
 * Manages scheduled RSS feed fetching with concurrent control and retry mechanism.
 */
export class RSSScheduler {
  private static instance: RSSScheduler | null = null;

  private scheduledTask: cron.ScheduledTask | null = null;
  private activeTasks: Map<number, FetchTask> = new Map();
  private config: SchedulerConfig;
  private isRunning: boolean = false;
  private stats = {
    completedTasks: 0,
    failedTasks: 0,
    totalArticlesFetched: 0,
    lastRunTime: undefined as Date | undefined,
  };

  private constructor(config: SchedulerConfig) {
    this.config = config;
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: SchedulerConfig): RSSScheduler {
    if (!RSSScheduler.instance) {
      if (!config) {
        throw new Error('RSSScheduler config required on first initialization');
      }
      RSSScheduler.instance = new RSSScheduler(config);
    }
    return RSSScheduler.instance;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      log.warn('Scheduler already running');
      return;
    }

    if (!this.config.enabled) {
      log.info('RSS scheduler disabled in config');
      return;
    }

    try {
      // Validate cron expression
      if (!cron.validate(this.config.schedule)) {
        throw new Error(`Invalid cron expression: ${this.config.schedule}`);
      }

      // Create scheduled task
      this.scheduledTask = cron.schedule(
        this.config.schedule,
        () => {
          this.runScheduledFetch().catch((err) => {
            log.error({ err }, 'Scheduled fetch error');
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
          maxConcurrent: this.config.maxConcurrent,
        },
        'RSS scheduler started'
      );
    } catch (error) {
      log.error({ error }, 'Failed to start RSS scheduler');
      throw error;
    }
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    log.info('Stopping RSS scheduler...');

    // Stop scheduled task
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }

    // Wait for active tasks to complete
    const maxWaitTime = 30000; // 30 seconds max
    const startTime = Date.now();

    while (this.activeTasks.size > 0 && Date.now() - startTime < maxWaitTime) {
      log.debug({ activeTasks: this.activeTasks.size }, 'Waiting for active tasks to complete');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (this.activeTasks.size > 0) {
      log.warn({ activeTasks: this.activeTasks.size }, 'Forced shutdown with active tasks');
    }

    this.isRunning = false;
    log.info('RSS scheduler stopped');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<SchedulerConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasRunning && this.config.enabled) {
      this.start();
    }

    log.info({ config: this.config }, 'Scheduler config updated');
  }

  /**
   * Scheduled fetch execution entry point
   */
  private async runScheduledFetch(): Promise<void> {
    const runId = `run-${Date.now()}`;
    const runLog = log.child({ runId });

    runLog.info('Starting scheduled RSS fetch');

    try {
      // Get all active RSS sources
      const sources = await getActiveRSSSourcesForFetch();
      runLog.info({ sourceCount: sources.length }, 'Retrieved active RSS sources');

      if (sources.length === 0) {
        runLog.info('No active RSS sources to fetch');
        return;
      }

      // Filter sources by fetch interval
      const sourcesToFetch = await this.filterSourcesByFetchInterval(sources);
      runLog.info(
        { sourceCount: sourcesToFetch.length },
        'Sources to fetch after interval check'
      );

      if (sourcesToFetch.length === 0) {
        runLog.info('No sources due for fetching');
        return;
      }

      // Create tasks
      const tasks: FetchTask[] = sourcesToFetch.map((source) => ({
        rssSourceId: source.id,
        userId: source.user_id,
        url: source.url,
        name: source.name,
        status: TaskStatus.PENDING,
        retryCount: 0,
        createdAt: new Date(),
      }));

      // Execute batch fetch
      const results = await this.executeFetchTasks(tasks);

      // Statistics
      const successCount = results.filter((r) => r.success).length;
      const totalArticles = results.reduce((sum, r) => sum + r.articlesCount, 0);
      const newArticles = results.reduce((sum, r) => sum + r.newArticlesCount, 0);

      runLog.info(
        {
          totalTasks: results.length,
          successCount,
          failedCount: results.length - successCount,
          totalArticles,
          newArticles,
        },
        'Scheduled fetch completed'
      );

      // Update stats
      this.stats.lastRunTime = new Date();
      this.stats.completedTasks += successCount;
      this.stats.failedTasks += results.length - successCount;
      this.stats.totalArticlesFetched += totalArticles;
    } catch (error) {
      runLog.error({ error }, 'Scheduled fetch failed');
    }
  }

  /**
   * Filter sources by fetch interval
   */
  private async filterSourcesByFetchInterval(
    sources: Array<{
      id: number;
      user_id: number;
      url: string;
      name: string;
      fetch_interval: number;
    }>
  ): Promise<Array<{ id: number; user_id: number; url: string; name: string }>> {
    const db = getDb();
    const now = Date.now();
    const sourcesToFetch: Array<{
      id: number;
      user_id: number;
      url: string;
      name: string;
    }> = [];

    for (const source of sources) {
      // Get last_fetched_at
      const sourceData = await db
        .selectFrom('rss_sources')
        .where('id', '=', source.id)
        .select('last_fetched_at')
        .executeTakeFirst();

      const lastFetched = sourceData?.last_fetched_at;

      if (!lastFetched) {
        // Never fetched, need to fetch
        sourcesToFetch.push(source);
        continue;
      }

      const lastFetchedTime = new Date(lastFetched).getTime();
      const elapsed = now - lastFetchedTime;
      const intervalMs = source.fetch_interval * 1000;

      if (elapsed >= intervalMs) {
        sourcesToFetch.push(source);
      }
    }

    return sourcesToFetch;
  }

  /**
   * Execute batch fetch tasks with concurrent control
   */
  private async executeFetchTasks(tasks: FetchTask[]): Promise<FetchResult[]> {
    const results: FetchResult[] = [];
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
      // Control concurrency
      if (executing.length >= this.config.maxConcurrent) {
        await Promise.race(executing);
      }

      // Create execution promise
      const promise = this.executeFetchTask(task).then((result) => {
        results.push(result);
        executing.splice(executing.indexOf(promise), 1);
      });

      executing.push(promise);
    }

    // Wait for all tasks to complete
    await Promise.all(executing);

    return results;
  }

  /**
   * Execute single fetch task
   */
  private async executeFetchTask(task: FetchTask): Promise<FetchResult> {
    const taskLog = log.child({ rssSourceId: task.rssSourceId, url: task.url });

    const startTime = Date.now();
    task.status = TaskStatus.RUNNING;
    task.startedAt = new Date();
    this.activeTasks.set(task.rssSourceId, task);

    try {
      taskLog.debug('Starting fetch task');

      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Fetch timeout')), this.config.fetchTimeout);
      });

      // Execute fetch
      const fetchPromise = this.doFetch(task);

      const result = await Promise.race([fetchPromise, timeoutPromise]);

      const duration = Date.now() - startTime;

      taskLog.info(
        {
          articlesCount: result.articlesCount,
          newArticlesCount: result.newArticlesCount,
          duration,
        },
        'Fetch task completed'
      );

      // Update task status
      task.status = TaskStatus.COMPLETED;
      task.completedAt = new Date();

      // Update last_fetched_at
      await this.updateSourceLastFetched(task.rssSourceId);

      return {
        rssSourceId: task.rssSourceId,
        success: true,
        articlesCount: result.articlesCount,
        newArticlesCount: result.newArticlesCount,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      taskLog.error({ error: errorMessage, duration }, 'Fetch task failed');

      task.status = TaskStatus.FAILED;
      task.lastError = errorMessage;
      task.completedAt = new Date();

      // Retry logic
      if (task.retryCount < this.config.maxRetries) {
        task.retryCount++;
        task.status = TaskStatus.RETRYING;

        // Calculate backoff delay
        const delay =
          this.config.retryDelay *
          Math.pow(this.config.retryBackoffMultiplier, task.retryCount - 1);

        taskLog.info({ retryCount: task.retryCount, delay }, 'Scheduling retry');

        await new Promise((resolve) => setTimeout(resolve, delay));

        return this.executeFetchTask(task);
      }

      return {
        rssSourceId: task.rssSourceId,
        success: false,
        articlesCount: 0,
        newArticlesCount: 0,
        error: errorMessage,
        duration,
      };
    } finally {
      this.activeTasks.delete(task.rssSourceId);
    }
  }

  /**
   * Actual fetch execution
   */
  private async doFetch(task: FetchTask): Promise<{
    articlesCount: number;
    newArticlesCount: number;
  }> {
    const parser = getRSSParser();
    const parseResult = await parser.parseFeed(task.url);

    if (!parseResult.success || !parseResult.feed) {
      throw new Error(parseResult.error || 'Failed to parse feed');
    }

    const feed = parseResult.feed;

    // Check if articles exist by (rss_source_id, title) combination
    const titles = feed.items.map((item) => item.title);
    const existingTitles = await checkArticlesExistByTitle(task.rssSourceId, titles);

    // Only save new articles
    const newItems = feed.items.filter((item) => !existingTitles.has(item.title));

    if (newItems.length > 0) {
      // Save articles to database and get new article IDs
      const saveResult = await saveArticles(task.rssSourceId, newItems);

      // DEBUG: Log saveResult
      log.info({ rssSourceId: task.rssSourceId, count: saveResult.count, articleIdsLength: saveResult.articleIds.length, articleIds: saveResult.articleIds }, 'saveArticles result');

      // Trigger auto-filter for new articles (in background, non-blocking)
      if (saveResult.articleIds.length > 0) {
        this.triggerAutoFilter(task.userId, saveResult.articleIds, newItems).catch((err) => {
          log.warn({ error: err, rssSourceId: task.rssSourceId }, 'Auto-filter failed (non-critical)');
        });
      } else {
        log.warn({ rssSourceId: task.rssSourceId, count: saveResult.count }, 'No article IDs returned, auto-filter not triggered');
      }
    }

    return {
      articlesCount: feed.items.length,
      newArticlesCount: newItems.length,
    };
  }

  /**
   * Trigger auto-filter for newly saved articles (background task)
   */
  private async triggerAutoFilter(
    userId: number,
    articleIds: number[],
    items: RSSFeedItem[]
  ): Promise<void> {
    const filterLog = log.child({ userId, articleCount: articleIds.length });
    filterLog.info('Starting auto-filter for new articles');

    let passedCount = 0;
    let rejectedCount = 0;

    // Create a map of URL to item for quick lookup
    const itemMap = new Map(items.map((item) => [item.link, item]));

    // Get articles from database to ensure we have the correct data
    const db = getDb();
    const articles = await db
      .selectFrom('articles')
      .where('id', 'in', articleIds)
      .select(['id', 'title', 'summary', 'content'])
      .execute();

    for (const article of articles) {
      try {
        const input: FilterInput = {
          articleId: article.id,
          userId: userId,
          title: article.title,
          description: article.summary || '',
          content: article.content || undefined,
        };

        const result = await filterArticle(input);

        if (result.passed) {
          passedCount++;
          filterLog.debug({ articleId: article.id }, 'Article passed filter');
        } else {
          rejectedCount++;
          filterLog.debug({ articleId: article.id, reason: result.filterReason }, 'Article rejected by filter');
        }
      } catch (error) {
        filterLog.warn({ articleId: article.id, error }, 'Filter failed for article');
      }
    }

    filterLog.info(
      { total: articles.length, passed: passedCount, rejected: rejectedCount },
      'Auto-filter completed'
    );
  }

  /**
   * Update source's last_fetched_at
   */
  private async updateSourceLastFetched(rssSourceId: number): Promise<void> {
    const db = getDb();
    const timestamp = new Date().toISOString();

    await db
      .updateTable('rss_sources')
      .set({
        last_fetched_at: timestamp,
        updated_at: timestamp,
      })
      .where('id', '=', rssSourceId)
      .execute();
  }

  /**
   * Get scheduler status
   */
  getStatus(): SchedulerStatus {
    // node-cron v3 doesn't have nextDate(), calculate manually
    const nextRun = this.isRunning ? new Date(Date.now() + 60000) : undefined;

    return {
      isRunning: this.isRunning,
      activeTasks: this.activeTasks.size,
      completedTasks: this.stats.completedTasks,
      failedTasks: this.stats.failedTasks,
      totalArticlesFetched: this.stats.totalArticlesFetched,
      lastRunTime: this.stats.lastRunTime,
      nextRunTime: nextRun,
    };
  }

  /**
   * Manual trigger fetch all sources
   */
  async fetchAllNow(): Promise<FetchResult[]> {
    log.info('Manual fetch all triggered');

    const sources = await getActiveRSSSourcesForFetch();

    const tasks: FetchTask[] = sources.map((source) => ({
      rssSourceId: source.id,
      userId: source.user_id,
      url: source.url,
      name: source.name,
      status: TaskStatus.PENDING,
      retryCount: 0,
      createdAt: new Date(),
    }));

    return this.executeFetchTasks(tasks);
  }

  /**
   * Manual trigger fetch single source
   */
  async fetchSourceNow(rssSourceId: number, userId: number): Promise<FetchResult> {
    log.info({ rssSourceId }, 'Manual fetch single source triggered');

    const db = getDb();
    const source = await db
      .selectFrom('rss_sources')
      .where('id', '=', rssSourceId)
      .where('user_id', '=', userId)
      .select(['id', 'url', 'user_id', 'name'])
      .executeTakeFirst();

    if (!source) {
      throw new Error('RSS source not found');
    }

    const task: FetchTask = {
      rssSourceId: source.id as number,
      userId: source.user_id as number,
      url: source.url as string,
      name: source.name as string,
      status: TaskStatus.PENDING,
      retryCount: 0,
      createdAt: new Date(),
    };

    const results = await this.executeFetchTasks([task]);
    return results[0];
  }
}

/**
 * Initialize and get scheduler instance
 */
export function initRSSScheduler(): RSSScheduler {
  const config: SchedulerConfig = {
    enabled: process.env.RSS_FETCH_ENABLED !== 'false',
    schedule: process.env.RSS_FETCH_SCHEDULE || '0 9 * * *',
    maxConcurrent: parseInt(process.env.RSS_MAX_CONCURRENT || '5', 10),
    fetchTimeout: parseInt(process.env.RSS_FETCH_TIMEOUT || '30000', 10),
    maxRetries: 3,
    retryDelay: 5000, // 5 seconds
    retryBackoffMultiplier: 2,
  };

  return RSSScheduler.getInstance(config);
}
