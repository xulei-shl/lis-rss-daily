/**
 * Related Articles Scheduler Module
 *
 * Periodic refresh of related articles cache using node-cron.
 * Ensures that as the article corpus grows, older articles get updated
 * recommendations with newer relevant content.
 *
 * Features:
 * - Smart refresh based on staleness (articles not updated in N days)
 * - Batch processing with concurrency control
 * - Graceful shutdown
 * - Manual trigger support
 */

import cron from 'node-cron';
import { logger } from './logger.js';
import {
  batchRefreshRelated,
  getArticlesNeedingRefresh,
  getRefreshStats,
  type RefreshResult,
} from './api/articles-refresh.js';

const log = logger.child({ module: 'related-scheduler' });

/**
 * Scheduler configuration
 */
export interface RelatedSchedulerConfig {
  enabled: boolean;
  schedule: string;
  batchSize: number;
  staleDays: number;
}

/**
 * Scheduler status
 */
export interface RelatedSchedulerStatus {
  isRunning: boolean;
  lastRunTime?: Date;
  nextRunTime?: Date;
  lastRunStats?: {
    total: number;
    success: number;
    failed: number;
  };
  stats?: {
    total: number;
    fresh: number;
    stale: number;
    missing: number;
  };
}

/**
 * Related Articles Scheduler class
 *
 * Manages periodic refresh of related articles cache.
 */
export class RelatedArticlesScheduler {
  private static instance: RelatedArticlesScheduler | null = null;

  private scheduledTask: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;
  private config: RelatedSchedulerConfig;
  private lastRunTime: Date | undefined;
  private lastRunStats: { total: number; success: number; failed: number } | undefined;

  private constructor(config: RelatedSchedulerConfig) {
    this.config = config;
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: RelatedSchedulerConfig): RelatedArticlesScheduler {
    if (!RelatedArticlesScheduler.instance) {
      if (!config) {
        throw new Error('RelatedArticlesScheduler config required on first initialization');
      }
      RelatedArticlesScheduler.instance = new RelatedArticlesScheduler(config);
    }
    return RelatedArticlesScheduler.instance;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      log.warn('Related articles scheduler already running');
      return;
    }

    if (!this.config.enabled) {
      log.info('Related articles scheduler disabled in config');
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
          this.runScheduledRefresh().catch((err) => {
            log.error({ err }, 'Scheduled refresh error');
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
          batchSize: this.config.batchSize,
          staleDays: this.config.staleDays,
        },
        'Related articles scheduler started'
      );
    } catch (error) {
      log.error({ error }, 'Failed to start related articles scheduler');
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

    log.info('Stopping related articles scheduler...');

    // Stop scheduled task
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }

    this.isRunning = false;
    log.info('Related articles scheduler stopped');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<RelatedSchedulerConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasRunning && this.config.enabled) {
      this.start();
    }

    log.info({ config: this.config }, 'Related scheduler config updated');
  }

  /**
   * Scheduled refresh execution entry point
   */
  private async runScheduledRefresh(): Promise<void> {
    const runId = `run-${Date.now()}`;
    const runLog = log.child({ runId });

    runLog.info('Starting scheduled related articles refresh');

    // Get all users (for now, just user_id=1, the default admin)
    // In a multi-tenant system, you'd iterate over all active users
    const userId = 1;

    try {
      // Calculate stale date
      const staleBefore = new Date(Date.now() - this.config.staleDays * 24 * 60 * 60 * 1000);

      // Check if there are articles needing refresh
      const articlesToRefresh = await getArticlesNeedingRefresh(userId, {
        limit: 1, // Just check if there are any
        staleBefore,
      });

      if (articlesToRefresh.length === 0) {
        runLog.info('No articles need refresh at this time');
        return;
      }

      runLog.info(
        { hasArticles: true },
        'Articles need refresh, starting batch process'
      );

      // Perform batch refresh
      const results = await batchRefreshRelated(userId, {
        limit: this.config.batchSize,
        staleBefore,
      });

      // Statistics
      const success = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      this.lastRunTime = new Date();
      this.lastRunStats = { total: results.length, success, failed };

      runLog.info(
        {
          total: results.length,
          success,
          failed,
        },
        'Scheduled refresh completed'
      );
    } catch (error) {
      runLog.error({ error }, 'Scheduled refresh failed');
    }
  }

  /**
   * Manual trigger refresh
   */
  async refreshNow(userId: number = 1): Promise<RefreshResult[]> {
    log.info('Manual refresh triggered');

    const staleBefore = new Date(Date.now() - this.config.staleDays * 24 * 60 * 60 * 1000);

    const results = await batchRefreshRelated(userId, {
      limit: this.config.batchSize,
      staleBefore,
    });

    // Update stats
    const success = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    this.lastRunTime = new Date();
    this.lastRunStats = { total: results.length, success, failed };

    log.info(
      { total: results.length, success, failed },
      'Manual refresh completed'
    );

    return results;
  }

  /**
   * Get scheduler status
   */
  async getStatus(userId: number = 1): Promise<RelatedSchedulerStatus> {
    // Get cache freshness stats
    const stats = await getRefreshStats(userId);

    // Calculate next run time (approximate)
    const nextRun = this.isRunning ? new Date(Date.now() + 86400000) : undefined; // Rough estimate

    return {
      isRunning: this.isRunning,
      lastRunTime: this.lastRunTime,
      nextRunTime: nextRun,
      lastRunStats: this.lastRunStats,
      stats,
    };
  }
}

/**
 * Initialize and get scheduler instance
 */
export function initRelatedScheduler(config: RelatedSchedulerConfig): RelatedArticlesScheduler {
  return RelatedArticlesScheduler.getInstance(config);
}
