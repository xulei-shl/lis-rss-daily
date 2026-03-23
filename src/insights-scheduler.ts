/**
 * Insights Scheduler
 *
 * Scheduled insights report generation and push (WeChat + Telegram).
 * Runs every 15 days by default.
 */

import cron from 'node-cron';
import { logger } from './logger.js';
import { generateInsightsSummary } from './api/daily-summary.js';

const log = logger.child({ module: 'insights-scheduler' });

/**
 * Scheduler configuration
 */
export interface InsightsSchedulerConfig {
  enabled: boolean;
  schedule: string;
  days: number;
  userId: number;
}

/**
 * Scheduler status
 */
export interface InsightsSchedulerStatus {
  isRunning: boolean;
  lastRunTime?: Date;
  nextRunTime?: Date;
  lastRunResult?: {
    success: boolean;
    articleCount?: number;
    error?: string;
  };
}

/**
 * Insights Scheduler class
 */
export class InsightsScheduler {
  private static instance: InsightsScheduler | null = null;

  private scheduledTask: cron.ScheduledTask | null = null;
  private config: InsightsSchedulerConfig;
  private isRunning: boolean = false;
  private isExecuting: boolean = false;
  private stats = {
    lastRunTime: undefined as Date | undefined,
    lastRunResult: undefined as { success: boolean; articleCount?: number; error?: string } | undefined,
  };

  private constructor(config: InsightsSchedulerConfig) {
    this.config = config;
  }

  /**
   * Get singleton instance
   */
  static getInstance(config?: InsightsSchedulerConfig): InsightsScheduler {
    if (!InsightsScheduler.instance) {
      if (!config) {
        throw new Error('InsightsScheduler config required on first initialization');
      }
      InsightsScheduler.instance = new InsightsScheduler(config);
    }
    return InsightsScheduler.instance;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      log.warn('Insights scheduler already running');
      return;
    }

    if (!this.config.enabled) {
      log.info('Insights scheduler disabled in config');
      return;
    }

    try {
      if (!cron.validate(this.config.schedule)) {
        throw new Error(`Invalid cron expression: ${this.config.schedule}`);
      }

      this.scheduledTask = cron.schedule(
        this.config.schedule,
        () => {
          this.runInsightsReport().catch((err) => {
            log.error({ err }, 'Scheduled insights report error');
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
          days: this.config.days,
        },
        'Insights scheduler started'
      );
    } catch (error) {
      log.error({ error }, 'Failed to start insights scheduler');
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

    log.info('Stopping insights scheduler...');

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
    log.info('Insights scheduler stopped');
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<InsightsSchedulerConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...newConfig };

    if (wasRunning && this.config.enabled) {
      this.start();
    }

    log.info({ config: this.config }, 'Insights scheduler config updated');
  }

  /**
   * Scheduled execution entry point
   */
  private async runInsightsReport(): Promise<void> {
    if (this.isExecuting) {
      log.warn('Previous execution still in progress, skipping this run');
      return;
    }

    const runId = `run-${Date.now()}`;
    const runLog = log.child({ runId });

    runLog.info('Starting scheduled insights report generation');

    this.isExecuting = true;
    this.stats.lastRunTime = new Date();

    try {
      const result = await generateInsightsSummary({
        userId: this.config.userId,
        days: this.config.days,
      });

      this.stats.lastRunResult = {
        success: true,
        articleCount: result.totalArticles,
      };

      runLog.info(
        {
          date: result.date,
          articleCount: result.totalArticles,
        },
        'Insights report generated and pushed successfully'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.stats.lastRunResult = {
        success: false,
        error: errorMessage,
      };

      runLog.error({ error: errorMessage }, 'Failed to generate/push insights report');
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): InsightsSchedulerStatus {
    const nextRun = this.isRunning ? new Date(Date.now() + 60000) : undefined;

    return {
      isRunning: this.isRunning,
      lastRunTime: this.stats.lastRunTime,
      nextRunTime: nextRun,
      lastRunResult: this.stats.lastRunResult,
    };
  }

  /**
   * Manual trigger insights report now
   */
  async generateNow(): Promise<void> {
    log.info({ days: this.config.days }, 'Manual insights report triggered');

    try {
      const result = await generateInsightsSummary({
        userId: this.config.userId,
        days: this.config.days,
      });

      log.info(
        { date: result.date, articleCount: result.totalArticles },
        'Insights report generated and pushed successfully (manual)'
      );
    } catch (error) {
      log.error(
        { error },
        'Failed to generate/push insights report (manual)'
      );
    }
  }
}

/**
 * Initialize and get scheduler instance
 */
export function initInsightsScheduler(): InsightsScheduler {
  const config: InsightsSchedulerConfig = {
    enabled: process.env.INSIGHTS_ENABLED !== 'false',
    schedule: process.env.INSIGHTS_SCHEDULE || '0 1 */15 * *',
    days: parseInt(process.env.INSIGHTS_DAYS || '15', 10),
    userId: parseInt(process.env.INSIGHTS_USER_ID || '1', 10),
  };

  return InsightsScheduler.getInstance(config);
}
