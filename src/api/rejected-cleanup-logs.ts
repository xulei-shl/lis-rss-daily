/**
 * Rejected Cleanup Logs Service
 *
 * Persist and query rejected article cleanup scheduler run logs.
 */

import { getDb, type RejectedCleanupLogsTable } from '../db.js';
import { normalizeDateFields } from '../utils/datetime.js';

/* ── Types ── */

export type RejectedCleanupLogRecord = {
  id: number;
  user_id: number;
  total_sources: number;
  total_articles_moved: number;
  success_count: number;
  failed_count: number;
  duration_ms: number;
  is_scheduled: number;
  details_json: string | null;
  error_message: string | null;
  created_at: string;
};

export interface CreateRejectedCleanupLogInput {
  userId: number;
  totalSources: number;
  totalArticlesMoved: number;
  successCount: number;
  failedCount: number;
  durationMs: number;
  isScheduled: boolean;
  detailsJson?: string;
  errorMessage?: string;
}

export interface RejectedCleanupLogQuery {
  userId: number;
  page?: number;
  limit?: number;
  fromDate?: string;
  toDate?: string;
}

export interface RejectedCleanupLogResult {
  logs: RejectedCleanupLogRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ── Functions ── */

/**
 * Create a rejected cleanup log entry
 */
export async function createRejectedCleanupLog(
  input: CreateRejectedCleanupLogInput
): Promise<void> {
  const db = getDb();
  await db
    .insertInto('rejected_cleanup_logs')
    .values({
      user_id: input.userId,
      total_sources: input.totalSources,
      total_articles_moved: input.totalArticlesMoved,
      success_count: input.successCount,
      failed_count: input.failedCount,
      duration_ms: input.durationMs,
      is_scheduled: input.isScheduled ? 1 : 0,
      details_json: input.detailsJson || null,
      error_message: input.errorMessage || null,
    })
    .execute();
}

/**
 * Paginated query of rejected cleanup logs
 */
export async function getRejectedCleanupLogs(
  query: RejectedCleanupLogQuery
): Promise<RejectedCleanupLogResult> {
  const db = getDb();
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const offset = (page - 1) * limit;

  let baseQuery = db
    .selectFrom('rejected_cleanup_logs')
    .where('user_id', '=', query.userId);

  if (query.fromDate) {
    baseQuery = baseQuery.where('created_at', '>=', query.fromDate);
  }

  if (query.toDate) {
    baseQuery = baseQuery.where('created_at', '<=', query.toDate);
  }

  const countRow = await baseQuery
    .select((eb) => eb.fn.count('id').as('count'))
    .executeTakeFirst();
  const total = Number(countRow?.count ?? 0);

  const logs = await baseQuery
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  const normalizedLogs = (logs as RejectedCleanupLogRecord[]).map((log) =>
    normalizeDateFields(log as Record<string, any>, ['created_at'])
  ) as RejectedCleanupLogRecord[];

  return {
    logs: normalizedLogs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
