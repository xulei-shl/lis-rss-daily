/**
 * Rejected Article Cleanup Scheduler
 *
 * Periodically migrates rejected articles (filter_status='rejected') from the
 * main articles table to the rejected_articles archive table, along with
 * associated data (filter logs, translations, process logs, related articles).
 *
 * Only operates on sources with auto_cleanup_rejected=1 enabled.
 * Default schedule: daily at 5:00 AM.
 */

import { sql } from 'kysely';
import cron from 'node-cron';
import { getDb } from './db.js';
import { logger } from './logger.js';
import { config } from './config.js';

const log = logger.child({ module: 'rejected-cleanup-scheduler' });

/* ── Result Types ── */

export interface CleanupSourceResult {
  sourceType: string;
  sourceId: number;
  sourceName: string;
  articlesMoved: number;
  success: boolean;
  error?: string;
}

export interface CleanupResult {
  totalSources: number;
  totalArticlesMoved: number;
  successCount: number;
  failedCount: number;
  sourceResults: CleanupSourceResult[];
  durationMs: number;
}

/* ── Source Info Type ── */

interface SourceInfo {
  sourceType: 'rss' | 'journal' | 'keyword' | 'email';
  sourceId: number;
  sourceName: string;
  userId: number;
}

/* ── Scheduler ── */

export class RejectedCleanupScheduler {
  private static instance: RejectedCleanupScheduler | null = null;

  private scheduledTask: cron.ScheduledTask | null = null;
  private isRunning = false;

  static getInstance(): RejectedCleanupScheduler {
    if (!RejectedCleanupScheduler.instance) {
      RejectedCleanupScheduler.instance = new RejectedCleanupScheduler();
    }
    return RejectedCleanupScheduler.instance;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      log.warn('Rejected cleanup scheduler already running');
      return;
    }

    if (!config.rejectedCleanupEnabled) {
      log.info('Rejected cleanup scheduler disabled in config');
      return;
    }

    try {
      if (!cron.validate(config.rejectedCleanupSchedule)) {
        throw new Error(`Invalid cron expression: ${config.rejectedCleanupSchedule}`);
      }

      this.scheduledTask = cron.schedule(
        config.rejectedCleanupSchedule,
        () => {
          this.cleanupNow().catch((err) => {
            log.error({ err }, 'Scheduled rejected cleanup error');
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
        { schedule: config.rejectedCleanupSchedule },
        '🗑️ Rejected article cleanup scheduler started'
      );
    } catch (error) {
      log.error({ error }, 'Failed to start rejected cleanup scheduler');
      throw error;
    }
  }

  /**
   * Stop the scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    log.info('Stopping rejected cleanup scheduler...');

    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }

    this.isRunning = false;
    log.info('Rejected cleanup scheduler stopped');
  }

  /**
   * Manual trigger — cleanup all sources with auto_cleanup_rejected=1
   */
  async cleanupNow(): Promise<CleanupResult> {
    const startTime = Date.now();
    const runLog = log.child({ runId: `cleanup-${Date.now()}` });

    runLog.info('Starting rejected article cleanup');

    const sources = await this.collectEnabledSources();

    if (sources.length === 0) {
      runLog.info('No sources with auto_cleanup_rejected enabled');
      return {
        totalSources: 0,
        totalArticlesMoved: 0,
        successCount: 0,
        failedCount: 0,
        sourceResults: [],
        durationMs: 0,
      };
    }

    runLog.info({ sourceCount: sources.length }, 'Found sources with auto-cleanup enabled');

    const sourceResults: CleanupSourceResult[] = [];
    let totalArticlesMoved = 0;
    let successCount = 0;
    let failedCount = 0;

    for (const source of sources) {
      try {
        const result = await this.cleanupSource(source);
        sourceResults.push(result);
        totalArticlesMoved += result.articlesMoved;
        if (result.success) {
          successCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        runLog.error(
          { sourceType: source.sourceType, sourceId: source.sourceId, error: errorMessage },
          'Failed to cleanup source'
        );
        sourceResults.push({
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          sourceName: source.sourceName,
          articlesMoved: 0,
          success: false,
          error: errorMessage,
        });
        failedCount++;
      }
    }

    const durationMs = Date.now() - startTime;

    runLog.info(
      { totalSources: sources.length, totalArticlesMoved, successCount, failedCount, durationMs },
      'Rejected article cleanup completed'
    );

    return {
      totalSources: sources.length,
      totalArticlesMoved,
      successCount,
      failedCount,
      sourceResults,
      durationMs,
    };
  }

  /**
   * Collect all active sources with auto_cleanup_rejected=1
   */
  private async collectEnabledSources(): Promise<SourceInfo[]> {
    const db = getDb();
    const sources: SourceInfo[] = [];

    // RSS sources
    const rssSources = await db
      .selectFrom('rss_sources')
      .where('auto_cleanup_rejected', '=', 1)
      .where('status', '=', 'active')
      .select(['id', 'name', 'user_id'])
      .execute();
    for (const s of rssSources) {
      sources.push({ sourceType: 'rss', sourceId: s.id, sourceName: s.name, userId: s.user_id });
    }

    // Journals
    const journals = await db
      .selectFrom('journals')
      .where('auto_cleanup_rejected', '=', 1)
      .where('status', '=', 'active')
      .select(['id', 'name', 'user_id'])
      .execute();
    for (const j of journals) {
      sources.push({ sourceType: 'journal', sourceId: j.id, sourceName: j.name, userId: j.user_id });
    }

    // Keyword subscriptions
    const keywords = await db
      .selectFrom('keyword_subscriptions')
      .where('auto_cleanup_rejected', '=', 1)
      .where('is_active', '=', 1)
      .select(['id', 'keyword', 'user_id'])
      .execute();
    for (const k of keywords) {
      sources.push({ sourceType: 'keyword', sourceId: k.id, sourceName: k.keyword, userId: k.user_id });
    }

    // Email sources
    const emailSources = await db
      .selectFrom('email_sources')
      .where('auto_cleanup_rejected', '=', 1)
      .where('status', '=', 'active')
      .select(['id', 'name', 'user_id'])
      .execute();
    for (const e of emailSources) {
      sources.push({ sourceType: 'email', sourceId: e.id, sourceName: e.name, userId: e.user_id });
    }

    return sources;
  }

  /**
   * Cleanup rejected articles for a single source
   */
  private async cleanupSource(source: SourceInfo): Promise<CleanupSourceResult> {
    const sourceLog = log.child({ sourceType: source.sourceType, sourceId: source.sourceId, sourceName: source.sourceName });
    const db = getDb();

    // Build the source-specific WHERE clause
    const sourceColumn = this.getSourceColumn(source.sourceType);
    if (!sourceColumn) {
      return {
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceName: source.sourceName,
        articlesMoved: 0,
        success: false,
        error: `Unknown source type: ${source.sourceType}`,
      };
    }

    // Get rejected articles for this source
    const rejectedArticles = await db
      .selectFrom('articles')
      .where('filter_status', '=', 'rejected')
      .where(sql.ref(sourceColumn), '=', source.sourceId)
      .selectAll()
      .execute();

    if (rejectedArticles.length === 0) {
      sourceLog.debug('No rejected articles found for this source');
      return {
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        sourceName: source.sourceName,
        articlesMoved: 0,
        success: true,
      };
    }

    sourceLog.info({ articleCount: rejectedArticles.length }, 'Moving rejected articles to archive');

    let movedCount = 0;
    for (const article of rejectedArticles) {
      try {
        // Collect associated data
        const filterLogs = await db
          .selectFrom('article_filter_logs')
          .where('article_id', '=', article.id)
          .selectAll()
          .execute();

        const translation = await db
          .selectFrom('article_translations')
          .where('article_id', '=', article.id)
          .selectAll()
          .executeTakeFirst();

        const processLogs = await db
          .selectFrom('article_process_logs')
          .where('article_id', '=', article.id)
          .selectAll()
          .execute();

        const related = await db
          .selectFrom('article_related')
          .where('article_id', '=', article.id)
          .selectAll()
          .execute();

        // Begin transaction for atomic migration
        await db.transaction().execute(async (trx) => {
          // Insert into rejected_articles archive
          await trx
            .insertInto('rejected_articles')
            .values({
              id: article.id,
              rss_source_id: article.rss_source_id,
              journal_id: article.journal_id,
              keyword_id: article.keyword_id,
              email_source_id: article.email_source_id,
              title: article.title,
              title_normalized: article.title_normalized,
              url: article.url,
              summary: article.summary,
              content: article.content,
              markdown_content: article.markdown_content,
              filter_status: article.filter_status,
              filter_score: article.filter_score,
              filtered_at: article.filtered_at,
              process_status: article.process_status,
              process_stages: article.process_stages,
              processed_at: article.processed_at,
              published_at: article.published_at,
              published_year: article.published_year,
              published_issue: article.published_issue,
              published_volume: article.published_volume,
              error_message: article.error_message,
              is_read: article.is_read,
              source_origin: article.source_origin,
              rating: article.rating,
              ai_summary: article.ai_summary,
              created_at: article.created_at,
              updated_at: article.updated_at,
              filter_logs_data: JSON.stringify(filterLogs),
              translation_data: translation ? JSON.stringify(translation) : null,
              process_logs_data: JSON.stringify(processLogs),
              related_data: JSON.stringify(related),
              source_name: source.sourceName,
            })
            .execute();

          // Delete from articles — foreign key CASCADE will remove associated data
          await trx
            .deleteFrom('articles')
            .where('id', '=', article.id)
            .execute();
        });

        movedCount++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        sourceLog.error(
          { articleId: article.id, error: errorMessage },
          'Failed to move article to archive'
        );
      }
    }

    sourceLog.info(
      { movedCount, totalFound: rejectedArticles.length },
      'Source cleanup completed'
    );

    return {
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      articlesMoved: movedCount,
      success: true,
    };
  }

  /**
   * Get the source column name for a given source type
   */
  private getSourceColumn(sourceType: string): string | null {
    switch (sourceType) {
      case 'rss':
        return 'rss_source_id';
      case 'journal':
        return 'journal_id';
      case 'keyword':
        return 'keyword_id';
      case 'email':
        return 'email_source_id';
      default:
        return null;
    }
  }
}

/**
 * Initialize and return the scheduler singleton
 */
export function initRejectedCleanupScheduler(): RejectedCleanupScheduler {
  return RejectedCleanupScheduler.getInstance();
}
