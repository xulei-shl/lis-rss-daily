/**
 * BaseScheduler — shared skeleton for all cron-based schedulers.
 *
 * Eliminates the ~80 % code duplication that existed across RSSScheduler,
 * JournalScheduler, KeywordScheduler, GmailScheduler (and others).
 *
 * Subclasses need only implement:
 *   - `schedulerName`   – label for logging
 *   - `cronSchedule`    – the cron expression
 *   - `run()`           – the actual work to perform
 *   - `isEnabled()`     – whether this scheduler is turned on (default true)
 *
 * Optional overrides:
 *   - `waitForCompletion()` – called during stop() to wait for in-flight work
 */

import cron from 'node-cron';
import { logger } from '../logger.js';

const log = logger.child({ module: 'base-scheduler' });

export abstract class BaseScheduler {
  protected scheduledTask: cron.ScheduledTask | null = null;
  protected isRunning = false;

  /** Human-readable name for logging (e.g. 'RSS scheduler') */
  abstract get schedulerName(): string;

  /** Cron expression for the scheduled task */
  abstract get cronSchedule(): string;

  /** Whether the scheduler is enabled (checked before start) */
  get isEnabled(): boolean {
    return true;
  }

  /** The actual work each scheduler performs when cron fires */
  protected abstract run(): Promise<void>;

  // ── Lifecycle ──

  /**
   * Start the scheduler.
   * Validates the cron expression, creates the scheduled task, and kicks it off.
   */
  start(): void {
    if (this.isRunning) {
      log.warn({ scheduler: this.schedulerName }, 'Scheduler already running');
      return;
    }

    if (!this.isEnabled) {
      log.info({ scheduler: this.schedulerName }, 'Scheduler disabled');
      return;
    }

    try {
      if (!cron.validate(this.cronSchedule)) {
        throw new Error(`Invalid cron expression: ${this.cronSchedule}`);
      }

      this.scheduledTask = cron.schedule(
        this.cronSchedule,
        () => {
          this.run().catch((err) => {
            log.error({ err, scheduler: this.schedulerName }, 'Scheduled task error');
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
        { schedule: this.cronSchedule, scheduler: this.schedulerName },
        `${this.schedulerName} started`
      );
    } catch (error) {
      log.error({ error, scheduler: this.schedulerName }, 'Failed to start scheduler');
      throw error;
    }
  }

  /**
   * Stop the scheduler.
   * Stops the cron task, then optionally waits for in-flight work via
   * `waitForCompletion()`.
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    log.info({ scheduler: this.schedulerName }, `Stopping ${this.schedulerName}...`);

    // Stop scheduled task
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }

    // Allow subclasses to wait for in-flight work
    await this.waitForCompletion();

    this.isRunning = false;
    log.info({ scheduler: this.schedulerName }, `${this.schedulerName} stopped`);
  }

  /**
   * Override to wait for in-flight tasks/crawls during stop().
   * Default implementation returns immediately.
   */
  protected waitForCompletion(): Promise<void> {
    return Promise.resolve();
  }

  // NOTE: updateConfig() is NOT defined here because each scheduler has a
  // different config type. Subclasses (RSS, Journal) implement their own
  // typed updateConfig(newConfig: Partial<XxxConfig>) methods.
}
