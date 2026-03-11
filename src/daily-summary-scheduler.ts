/**
 * Daily Summary Push Scheduler
 *
 * Scheduled daily summary generation and push (WeChat + Telegram).
 * Features:
 * - Configurable schedule (default: 7:00 AM daily)
 * - Supports multiple summary types (journal, blog_news)
 * - Graceful shutdown
 */

import cron from 'node-cron';
import { logger } from './logger.js';
import { config } from './config.js';
import { generateDailySummary, generateJournalAllSummary } from './api/daily-summary.js';

const log = logger.child({ module: 'daily-summary-scheduler' });

/**
 * Scheduler configuration
 */
export interface DailySummarySchedulerConfig {
  enabled: boolean;
  schedule: string;
  types: string[];
  userId: number;
}

/**
 * Scheduler status
 */
export interface DailySummarySchedulerStatus {
  isRunning: boolean;
  lastRunTime?: Date;
  nextRunTime?: Date;
  lastRunResult?: {
    success: boolean;
    types: string[];
    error?: string;
  };
}

/**
 * Daily Summary Scheduler class
 */
export class DailySummaryScheduler {
  private static instance: DailySummaryScheduler | null = null;

  private scheduledTask: cron.ScheduledTask | null = null;
  private config: DailySummarySchedulerConfig;
  private isRunning: boolean = false;
  private isExecuting: boolean = false;
  private stats = {
    lastRunTime: undefined as Date | undefined,
    lastRunResult: undefined as { success: boolean; types: string[]; error?: string } | undefined,
  };

  private constructor(config: DailySummarySchedulerConfig) {
    this.config = config;
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: DailySummarySchedulerConfig): DailySummaryScheduler {
    if (!DailySummaryScheduler.instance) {
      if (!config) {
        throw new Error('DailySummaryScheduler config required on first initialization');
      }
      DailySummaryScheduler.instance = new DailySummaryScheduler(config);
    }
    return DailySummaryScheduler.instance;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      log.warn('Daily summary scheduler already running');
      return;
    }

    if (!this.config.enabled) {
      log.info('Daily summary scheduler disabled in config');
      return;
    }

    try {
      if (!cron.validate(this.config.schedule)) {
        throw new Error(`Invalid cron expression: ${this.config.schedule}`);
      }

      this.scheduledTask = cron.schedule(
        this.config.schedule,
        () => {
          this.runScheduledPush().catch((err) => {
            log.error({ err }, 'Scheduled daily summary push error');
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
          types: this.config.types,
        },
        'Daily summary scheduler started'
      );
    } catch (error) {
      log.error({ error }, 'Failed to start daily summary scheduler');
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

    log.info('Stopping daily summary scheduler...');

    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }

    const maxWaitTime = 300000;
    const startTime = Date.now();
    while (this.isExecuting && Date.now() - startTime < maxWaitTime) {
      log.debug('Waiting for current execution to complete');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (this.isExecuting) {
      log.warn('Forced shutdown while execution in progress');
    }

    this.isRunning = false;
    log.info('Daily summary scheduler stopped');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<DailySummarySchedulerConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasRunning && this.config.enabled) {
      this.start();
    }

    log.info({ config: this.config }, 'Daily summary scheduler config updated');
  }

  /**
   * Scheduled push execution entry point
   */
  private async runScheduledPush(): Promise<void> {
    if (this.isExecuting) {
      log.warn('Previous execution still in progress, skipping this run');
      return;
    }

    const runId = `run-${Date.now()}`;
    const runLog = log.child({ runId });

    runLog.info('Starting scheduled daily summary push');

    this.isExecuting = true;
    this.stats.lastRunTime = new Date();

    try {
      const results: Array<{ type: string; success: boolean; articleCount?: number; error?: string }> = [];

      // 生成各类总结
      for (const type of this.config.types) {
        try {
          runLog.info({ type }, 'Generating daily summary');

          let result;
          if (type === 'journal_all') {
            result = await generateJournalAllSummary({
              userId: this.config.userId,
            });
          } else {
            result = await generateDailySummary({
              userId: this.config.userId,
              type: type as any,
            });
          }

          results.push({
            type,
            success: true,
            articleCount: result.totalArticles,
          });

          runLog.info(
            { type, articleCount: result.totalArticles },
            'Daily summary generated and pushed successfully'
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          results.push({
            type,
            success: false,
            error: errorMessage,
          });

          runLog.error(
            { type, error: errorMessage },
            'Failed to generate/push daily summary'
          );
        }
      }

      const allSuccess = results.every(r => r.success);
      this.stats.lastRunResult = {
        success: allSuccess,
        types: this.config.types,
        error: allSuccess ? undefined : 'Some summaries failed',
      };

      runLog.info(
        {
          results,
          successCount: results.filter(r => r.success).length,
          totalCount: results.length,
        },
        'Scheduled daily summary push completed'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.stats.lastRunResult = {
        success: false,
        types: this.config.types,
        error: errorMessage,
      };

      runLog.error({ error }, 'Scheduled daily summary push failed');
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): DailySummarySchedulerStatus {
    const nextRun = this.isRunning ? new Date(Date.now() + 60000) : undefined;

    return {
      isRunning: this.isRunning,
      lastRunTime: this.stats.lastRunTime,
      nextRunTime: nextRun,
      lastRunResult: this.stats.lastRunResult,
    };
  }

  /**
   * Manual trigger push now
   */
  async pushNow(types?: string[]): Promise<void> {
    log.info({ types: types || this.config.types }, 'Manual daily summary push triggered');

    const typesToRun = types || this.config.types;

    for (const type of typesToRun) {
      try {
        log.info({ type }, 'Generating daily summary (manual)');

        let result;
        if (type === 'journal_all') {
          result = await generateJournalAllSummary({
            userId: this.config.userId,
          });
        } else {
          result = await generateDailySummary({
            userId: this.config.userId,
            type: type as any,
          });
        }

        log.info(
          { type, articleCount: result.totalArticles },
          'Daily summary generated and pushed successfully (manual)'
        );
      } catch (error) {
        log.error(
          { type, error },
          'Failed to generate/push daily summary (manual)'
        );
      }
    }
  }
}

/**
 * Initialize and get scheduler instance
 */
export function initDailySummaryScheduler(): DailySummaryScheduler {
  const config: DailySummarySchedulerConfig = {
    enabled: process.env.DAILY_SUMMARY_ENABLED !== 'false',
    schedule: process.env.DAILY_SUMMARY_SCHEDULE || '0 7 * * *',
    types: (process.env.DAILY_SUMMARY_TYPES || 'journal,blog_news,journal_all').split(','),
    userId: parseInt(process.env.DAILY_SUMMARY_USER_ID || '1', 10),
  };

  return DailySummaryScheduler.getInstance(config);
}
