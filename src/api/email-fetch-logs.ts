import { getDb, type EmailFetchLogsSelection } from '../db.js';
import { logger } from '../logger.js';
import { normalizeDateFields } from '../utils/datetime.js';

const log = logger.child({ module: 'email-fetch-logs' });

export type EmailFetchStatus = 'success' | 'failed';

export interface EmailFetchLogRecord extends EmailFetchLogsSelection {
  email_source_name: string | null;
}

export interface EmailFetchLogQuery {
  page?: number;
  limit?: number;
  status?: EmailFetchStatus;
  emailSourceId?: number;
  fromDate?: string;
  toDate?: string;
}

export interface EmailFetchLogResult {
  logs: EmailFetchLogRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function getEmailFetchLogs(query: EmailFetchLogQuery): Promise<EmailFetchLogResult> {
  const db = getDb();
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const offset = (page - 1) * limit;

  let baseQuery = db
    .selectFrom('email_fetch_logs')
    .innerJoin('email_sources', 'email_sources.id', 'email_fetch_logs.email_source_id');

  if (query.status) {
    baseQuery = baseQuery.where('email_fetch_logs.status', '=', query.status);
  }

  if (query.emailSourceId) {
    baseQuery = baseQuery.where('email_fetch_logs.email_source_id', '=', query.emailSourceId);
  }

  if (query.fromDate) {
    baseQuery = baseQuery.where('email_fetch_logs.created_at', '>=', query.fromDate);
  }

  if (query.toDate) {
    baseQuery = baseQuery.where('email_fetch_logs.created_at', '<=', query.toDate);
  }

  const countRow = await baseQuery
    .select((eb) => eb.fn.count('email_fetch_logs.id').as('count'))
    .executeTakeFirst();
  const total = Number(countRow?.count ?? 0);

  const logs = await baseQuery
    .select([
      'email_fetch_logs.id',
      'email_fetch_logs.email_source_id',
      'email_fetch_logs.status',
      'email_fetch_logs.emails_found',
      'email_fetch_logs.emails_new',
      'email_fetch_logs.error_message',
      'email_fetch_logs.duration_ms',
      'email_fetch_logs.created_at',
      'email_sources.name as email_source_name',
    ])
    .orderBy('email_fetch_logs.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  const normalizedLogs = (logs as EmailFetchLogRecord[]).map(log =>
    normalizeDateFields(log as Record<string, any>, ['created_at'])
  );

  return {
    logs: normalizedLogs,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}
