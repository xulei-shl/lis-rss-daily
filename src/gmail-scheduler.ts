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

      // 启动时检查：如果今天已经通过 cron 执行过抓取，则跳过启动抓取
      // 防止进程重启导致同一天抓取两次
      this.runStartupFetchIfNeeded().catch((err) => {
        log.error({ err }, 'Gmail startup fetch check error');
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

  /** 获取 Asia/Shanghai 时区的今日日期字符串 YYYY-MM-DD */
  private getTodayShanghai(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  }

  /**
   * 启动时检查今天是否已有抓取记录，避免 cron 已执行后进程重启导致同一天重复抓取
   */
  private async runStartupFetchIfNeeded(): Promise<void> {
    const db = getDb();
    const today = this.getTodayShanghai();

    // 查询是否有活跃邮件源在今天（Asia/Shanghai）已抓取过
    // last_fetched_at 存储为 UTC ISO 字符串，需转换比较
    const todayStartShanghai = new Date(`${today}T00:00:00+08:00`).toISOString();

    const alreadyFetched = await db
      .selectFrom('email_sources')
      .where('status', '=', 'active')
      .where('last_fetched_at', '>=', todayStartShanghai)
      .select(db.fn.countAll<number>().as('count'))
      .executeTakeFirst();

    if (alreadyFetched && Number(alreadyFetched.count) > 0) {
      log.info({ today }, 'Skipping startup fetch — cron already ran today');
      return;
    }

    log.info({ today }, 'Running startup fetch (cron has not run today)');
    await this.runScheduledFetch();
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
      domainId: row.domain_id,
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
      domainId: row.domain_id,
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
