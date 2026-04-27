/**
 * Insights Scheduler
 *
 * Scheduled insights report generation and push (WeChat + Telegram).
 * 默认每天检查一次，满足间隔天数后再执行。
 */

import cron from 'node-cron';
import { logger } from './logger.js';
import { generateInsightsSummary } from './api/daily-summary.js';
import { config as appConfig } from './config.js';
import { getUserSetting, setUserSetting } from './api/settings.js';
import { buildUtcRangeFromLocalDate } from './api/timezone.js';

const log = logger.child({ module: 'insights-scheduler' });
const INSIGHTS_LAST_SUCCESS_AT_KEY = 'insights_last_success_at';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const SCHEDULER_TIMEZONE = appConfig.defaultTimezone || 'Asia/Shanghai';

const localDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHEDULER_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getLocalDateKey(date: Date): string {
  return localDateFormatter.format(date);
}

function getLocalDateStartMs(date: Date): number {
  const [year, month, day] = getLocalDateKey(date).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function shiftLocalDateKey(localDateKey: string, days: number): string {
  const [year, month, day] = localDateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function parseFixedDailySchedule(schedule: string): { hour: number; minute: number } | undefined {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    return undefined;
  }

  const [minutePart, hourPart, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') {
    return undefined;
  }

  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return undefined;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return undefined;
  }

  return { hour, minute };
}

function getScheduledRunTimeForLocalDate(
  localDateKey: string,
  schedule: { hour: number; minute: number }
): Date {
  const [startUtc] = buildUtcRangeFromLocalDate(localDateKey, SCHEDULER_TIMEZONE);
  const runTime = new Date(startUtc);
  runTime.setUTCMinutes(runTime.getUTCMinutes() + schedule.hour * 60 + schedule.minute);
  return runTime;
}

function getNextFixedDailyRunTime(schedule: string, currentTime: Date = new Date()): Date | undefined {
  const parsedSchedule = parseFixedDailySchedule(schedule);
  if (!parsedSchedule) {
    return undefined;
  }

  const currentLocalDate = getLocalDateKey(currentTime);
  const todayRunTime = getScheduledRunTimeForLocalDate(currentLocalDate, parsedSchedule);
  if (todayRunTime > currentTime) {
    return todayRunTime;
  }

  return getScheduledRunTimeForLocalDate(shiftLocalDateKey(currentLocalDate, 1), parsedSchedule);
}

/**
 * Scheduler configuration
 */
export interface InsightsSchedulerConfig {
  enabled: boolean;
  schedule: string;
  intervalDays: number;
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
  lastSuccessAt?: Date;
  nextEligibleLocalDate?: string;
  schedulerTimezone: string;
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
  private lastSuccessfulScheduledRunAt?: Date;
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
          this.runScheduledInsightsReport().catch((err) => {
            log.error({ err }, 'Scheduled insights report error');
          });
        },
        {
          scheduled: false,
          timezone: SCHEDULER_TIMEZONE,
        }
      );

      this.scheduledTask.start();
      this.isRunning = true;

      log.info(
        {
          schedule: this.config.schedule,
          intervalDays: this.config.intervalDays,
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
   * 定时任务入口：只有满足间隔天数才真正执行
   */
  private async runScheduledInsightsReport(): Promise<void> {
    const lastSuccessAt = await this.getLastSuccessAt();
    const intervalCheck = this.getScheduledReportIntervalCheck(lastSuccessAt);
    if (!intervalCheck.shouldRun) {
      log.debug(
        {
          lastSuccessAt: lastSuccessAt?.toISOString(),
          lastSuccessLocalDate: intervalCheck.lastSuccessLocalDate,
          currentLocalDate: intervalCheck.currentLocalDate,
          elapsedDays: intervalCheck.elapsedDays,
          intervalDays: this.config.intervalDays,
        },
        'Insights interval not reached, skipping scheduled run'
      );
      return;
    }

    await this.runInsightsReport({
      shouldPersistSuccessTime: true,
      trigger: 'scheduled',
    });
  }

  /**
   * 执行洞察报告生成
   */
  private async runInsightsReport(options: {
    shouldPersistSuccessTime: boolean;
    trigger: 'scheduled' | 'manual';
  }): Promise<void> {
    if (this.isExecuting) {
      log.warn('Previous execution still in progress, skipping this run');
      return;
    }

    const runId = `run-${Date.now()}`;
    const runLog = log.child({ runId });

    runLog.info({ trigger: options.trigger }, 'Starting insights report generation');

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

      if (options.shouldPersistSuccessTime) {
        const successAt = new Date();
        await setUserSetting(
          this.config.userId,
          INSIGHTS_LAST_SUCCESS_AT_KEY,
          successAt.toISOString()
        );
        this.lastSuccessfulScheduledRunAt = successAt;
      }

      runLog.info(
        {
          trigger: options.trigger,
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

      runLog.error(
        { trigger: options.trigger, error: errorMessage },
        'Failed to generate/push insights report'
      );
    } finally {
      this.isExecuting = false;
    }
  }

  /**
   * 获取上次成功执行时间
   */
  private async getLastSuccessAt(): Promise<Date | undefined> {
    const value = await getUserSetting(this.config.userId, INSIGHTS_LAST_SUCCESS_AT_KEY);
    if (!value) {
      return undefined;
    }

    const lastSuccessAt = new Date(value);
    if (Number.isNaN(lastSuccessAt.getTime())) {
      log.warn({ value }, 'Invalid insights last success time found in settings');
      return undefined;
    }

    this.lastSuccessfulScheduledRunAt = lastSuccessAt;
    return lastSuccessAt;
  }

  /**
   * 判断是否已达到下一次定时执行的最小间隔
   */
  private getScheduledReportIntervalCheck(lastSuccessAt?: Date, currentTime: Date = new Date()): {
    shouldRun: boolean;
    lastSuccessLocalDate?: string;
    currentLocalDate?: string;
    elapsedDays?: number;
  } {
    if (!lastSuccessAt) {
      return { shouldRun: true };
    }

    const lastSuccessLocalDate = getLocalDateKey(lastSuccessAt);
    const currentLocalDate = getLocalDateKey(currentTime);
    const elapsedDays = Math.floor(
      (getLocalDateStartMs(currentTime) - getLocalDateStartMs(lastSuccessAt)) / DAY_IN_MS
    );

    return {
      shouldRun: elapsedDays >= this.config.intervalDays,
      lastSuccessLocalDate,
      currentLocalDate,
      elapsedDays,
    };
  }

  /**
   * Get scheduler status
   */
  getStatus(): InsightsSchedulerStatus {
    const nextRun = this.isRunning ? getNextFixedDailyRunTime(this.config.schedule) : undefined;
    const nextEligibleLocalDate = this.lastSuccessfulScheduledRunAt
      ? shiftLocalDateKey(getLocalDateKey(this.lastSuccessfulScheduledRunAt), this.config.intervalDays)
      : undefined;

    return {
      isRunning: this.isRunning,
      lastRunTime: this.stats.lastRunTime,
      nextRunTime: nextRun,
      lastSuccessAt: this.lastSuccessfulScheduledRunAt,
      nextEligibleLocalDate,
      schedulerTimezone: SCHEDULER_TIMEZONE,
      lastRunResult: this.stats.lastRunResult,
    };
  }

  /**
   * Manual trigger insights report now
   */
  async generateNow(): Promise<void> {
    log.info({ days: this.config.days }, 'Manual insights report triggered');

    try {
      await this.runInsightsReport({
        shouldPersistSuccessTime: false,
        trigger: 'manual',
      });
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
  const schedulerConfig: InsightsSchedulerConfig = {
    enabled: appConfig.insightsEnabled,
    schedule: appConfig.insightsSchedule,
    intervalDays: appConfig.insightsIntervalDays,
    days: appConfig.insightsDays,
    userId: appConfig.insightsUserId,
  };

  return InsightsScheduler.getInstance(schedulerConfig);
}
