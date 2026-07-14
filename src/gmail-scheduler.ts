import { getDb } from './db.js';
import { logger } from './logger.js';
import { config } from './config.js';
import { BaseScheduler } from './utils/base-scheduler.js';
import { processEmailSource } from './gmail/email-processor.js';
import type { EmailSourceConfig } from './gmail/types.js';
/**
 * Map a database row to EmailSourceConfig
 */
function rowToEmailSourceConfig(row: {
  id: number;
  user_id: number;
  name: string;
  email_address: string;
  imap_password_encrypted: string;
  target_senders: string;
  domain_id: number;
  status: string;
  last_fetched_at: string | null;
  last_error: string | null;
}): EmailSourceConfig {
  return {
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
}

const log = logger.child({ module: 'gmail-scheduler' });

export class GmailScheduler extends BaseScheduler {
  private static instance: GmailScheduler | null = null;

  /* ── BaseScheduler overrides ── */

  get schedulerName(): string { return 'Gmail scheduler'; }
  get cronSchedule(): string { return config.gmailFetchSchedule; }
  get isEnabled(): boolean { return config.gmailFetchEnabled; }

  private constructor() {
    super();
  }

  static getInstance(): GmailScheduler {
    if (!GmailScheduler.instance) {
      GmailScheduler.instance = new GmailScheduler();
    }
    return GmailScheduler.instance;
  }

  /**
   * Start the scheduler (adds startup fetch check on top of base)
   */
  start(): void {
    super.start();
    if (this.isRunning) {
      // 启动时检查：如果今天已经通过 cron 执行过抓取，则跳过启动抓取
      this.runStartupFetchIfNeeded().catch((err) => {
        log.error({ err }, 'Gmail startup fetch check error');
      });
    }
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
    await this.run();
  }

  /** BaseScheduler.run() */
  protected async run(): Promise<void> {
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

    const sources: EmailSourceConfig[] = rows.map((row) => rowToEmailSourceConfig(row));

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
    await this.run();
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

    const source: EmailSourceConfig = rowToEmailSourceConfig(row);

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
