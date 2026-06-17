import cron from 'node-cron';
import { getDb } from './db.js';
import { logger } from './logger.js';
import { config } from './config.js';
import { processEmailSource } from './gmail/email-processor.js';
import type { EmailSourceConfig } from './gmail/types.js';

const log = logger.child({ module: 'gmail-scheduler' });

export class GmailScheduler {
  private static instance: GmailScheduler | null = null;
  private scheduledTask: cron.ScheduledTask | null = null;
  private isRunning = false;

  private constructor() {}

  static getInstance(): GmailScheduler {
    if (!GmailScheduler.instance) {
      GmailScheduler.instance = new GmailScheduler();
    }
    return GmailScheduler.instance;
  }

  start(): void {
    if (this.isRunning) {
      log.warn('Gmail scheduler already running');
      return;
    }

    if (!config.gmailFetchEnabled) {
      log.info('Gmail scheduler disabled in config');
      return;
    }

    try {
      if (!cron.validate(config.gmailFetchSchedule)) {
        throw new Error(`Invalid cron expression: ${config.gmailFetchSchedule}`);
      }

      this.scheduledTask = cron.schedule(
        config.gmailFetchSchedule,
        () => {
          this.runScheduledFetch().catch((err) => {
            log.error({ err }, 'Gmail scheduled fetch error');
          });
        },
        { scheduled: false, timezone: 'Asia/Shanghai' }
      );

        this.scheduledTask.start();
        this.isRunning = true;
        log.info(`Gmail scheduler started (schedule: ${config.gmailFetchSchedule})`);

        // 启动时立即执行一次，防止进程在 cron 调度时间之后启动导致当天错过执行
        this.runScheduledFetch().catch((err) => {
          log.error({ err }, 'Gmail startup fetch error');
        });
    } catch (err) {
      log.error({ err }, 'Failed to start Gmail scheduler');
    }
  }

  stop(): Promise<void> {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }
    this.isRunning = false;
    log.info('Gmail scheduler stopped');
    return Promise.resolve();
  }

  private async runScheduledFetch(): Promise<void> {
    const db = getDb();

    const rows = await db
      .selectFrom('email_sources')
      .where('status', '=', 'active')
      .selectAll()
      .execute();

    if (rows.length === 0) {
      log.info('No active email sources to fetch');
      return;
    }

    const sources: EmailSourceConfig[] = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      emailAddress: row.email_address,
      imapPasswordEncrypted: row.imap_password_encrypted,
      targetSenders: JSON.parse(row.target_senders || '[]'),
      status: row.status as 'active' | 'inactive',
      lastFetchedAt: row.last_fetched_at,
      lastError: row.last_error,
    }));

    for (const source of sources) {
      try {
        const result = await processEmailSource(source);
        if (result.success) {
          log.info({ sourceId: source.id, new: result.emailsNew }, 'Email source fetched');
        } else {
          log.warn({ sourceId: source.id, error: result.error }, 'Email source fetch failed');
        }
      } catch (err: any) {
        log.error({ sourceId: source.id, error: err.message }, 'Email source fetch error');
      }
    }
  }

  async fetchAllNow(): Promise<void> {
    log.info('Manual Gmail fetch triggered');
    await this.runScheduledFetch();
  }

  async fetchOneNow(sourceId: number): Promise<void> {
    const db = getDb();
    const row = await db
      .selectFrom('email_sources')
      .where('id', '=', sourceId)
      .selectAll()
      .executeTakeFirst();

    if (!row) {
      log.warn({ sourceId }, 'Email source not found');
      return;
    }

    const source: EmailSourceConfig = {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      emailAddress: row.email_address,
      imapPasswordEncrypted: row.imap_password_encrypted,
      targetSenders: JSON.parse(row.target_senders || '[]'),
      status: row.status as 'active' | 'inactive',
      lastFetchedAt: row.last_fetched_at,
      lastError: row.last_error,
    };

    try {
      const result = await processEmailSource(source);
      if (result.success) {
        log.info({ sourceId: source.id, new: result.emailsNew }, 'Email source fetched');
      } else {
        log.warn({ sourceId: source.id, error: result.error }, 'Email source fetch failed');
      }
    } catch (err: any) {
      log.error({ sourceId: source.id, error: err.message }, 'Email source fetch error');
    }
  }
}

export function initGmailScheduler(): GmailScheduler {
  return GmailScheduler.getInstance();
}
