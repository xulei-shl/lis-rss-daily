/**
 * Daily Summary Repository
 *
 * Handles all database operations for daily summaries:
 * - Querying articles for summary generation
 * - Saving/retrieving summary records
 * - History management
 */

import { getDb, type DailySummariesSelection } from '../db.js';
import { logger } from '../logger.js';
import { getUserTimezone, buildUtcRangeFromLocalDate, getUserLocalDate } from './timezone.js';
import { SOURCE_TYPE_PRIORITY } from '../constants/source-types.js';
import type { SourceType } from '../constants/source-types.js';

const log = logger.child({ module: 'daily-summary-repository' });

// ============================================================================
// Types
// ============================================================================

export type SummaryType = 'journal' | 'blog_news' | 'all' | 'search' | 'journal_all' | 'insights';

export interface DailySummaryArticle {
  id: number;
  title: string;
  url: string;
  summary: string | null;
  markdown_content: string | null;
  source_name: string;
  source_type: SourceType;
  published_at: string | null;
}

export interface DailySummaryInput {
  userId: number;
  date?: string; // YYYY-MM-DD format, defaults to today
  limit?: number; // Deprecated, use type to determine count
  type?: SummaryType;
}

export interface DailySummaryResult {
  date: string;
  type: SummaryType;
  totalArticles: number;
  articlesByType: {
    journal: DailySummaryArticle[];
    blog: DailySummaryArticle[];
    news: DailySummaryArticle[];
    email: DailySummaryArticle[];
  };
  summary: string;
  generatedAt: string;
}

export interface DailySummaryHistoryItem {
  id: number;
  summary_date: string;
  summary_type: SummaryType;
  article_count: number;
  summary_content: string;
  created_at: string;
}

export interface SaveDailySummaryInput {
  userId: number;
  date: string;
  type: SummaryType;
  articleCount: number;
  summaryContent: string;
  articlesData: DailySummaryResult['articlesByType'];
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Get daily passed articles, sorted by source type.
 *
 * Quantity limits:
 * - journal: 50 articles
 * - blog_news: 30 articles
 * - all: 60 articles (40 journal priority, remaining from blog/news)
 */
export async function getDailyPassedArticles(
  userId: number,
  dateStr: string,
  type?: SummaryType
): Promise<DailySummaryArticle[]> {
  const db = getDb();

  // Get user timezone
  const timezone = await getUserTimezone(userId);

  // Calculate UTC date range from local date
  const [startDate, endDate] = buildUtcRangeFromLocalDate(dateStr, timezone);

  log.info({ userId, date: dateStr, timezone, startDate, endDate, type }, 'Daily article query date range');

  const JOURNAL_LIMIT = 50;
  const BLOG_NEWS_LIMIT = 30;
  const ALL_TOTAL_LIMIT = 60;
  const ALL_JOURNAL_PRIORITY = 40;

  const buildBaseQuery = () => {
    return db
      .selectFrom('articles')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('journals', 'journals.id', 'articles.journal_id')
      .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
      .leftJoin('email_sources', 'email_sources.id', 'articles.email_source_id')
      .leftJoin('web_sources', 'web_sources.id', 'articles.web_source_id')
      .where('articles.filter_status', '=', 'passed')
      .where((eb) => eb.or([
        eb('rss_sources.user_id', '=', userId),
        eb('journals.user_id', '=', userId),
        eb('keyword_subscriptions.user_id', '=', userId),
        eb('email_sources.user_id', '=', userId),
        eb('web_sources.user_id', '=', userId),
      ]))
      .where('articles.created_at', '>=', startDate)
      .where('articles.created_at', '<=', endDate);
  };

  const executeQuery = async (query: any, limit: number) => {
    const articles = await query
      .select((eb: any) => [
        'articles.id',
        'articles.title',
        'articles.url',
        'articles.summary',
        'articles.markdown_content',
        'articles.published_at',
        'articles.source_origin',
        eb.fn.coalesce('rss_sources.name', 'journals.name', 'keyword_subscriptions.keyword', 'email_sources.name', 'web_sources.name').as('source_name'),
        eb.fn.coalesce('rss_sources.source_type', 'web_sources.source_type', eb.val('journal')).as('source_type'),
      ])
      .orderBy('articles.created_at', 'desc')
      .limit(limit)
      .execute();

    return articles.map((row: any) => {
      let sourceName = row.source_name || '未知来源';
      if (row.source_origin === 'keyword') {
        sourceName = `关键词: ${row.source_name}`;
      }

      let sourceType = row.source_type || 'blog';
      if (row.source_origin === 'email') {
        sourceType = 'email';
        sourceName = row.source_name || sourceName;
      }
      if (row.source_origin === 'web') {
        sourceName = row.source_name || sourceName;
      }

      return {
        id: row.id,
        title: row.title,
        url: row.url,
        summary: row.summary,
        markdown_content: row.markdown_content,
        source_name: sourceName,
        source_type: sourceType,
        published_at: row.published_at,
      };
    });
  };

  let result: DailySummaryArticle[] = [];

  if (type === 'journal') {
    const query = buildBaseQuery().where((eb) => eb.or([
      eb('articles.source_origin', '=', 'journal'),
      eb('articles.source_origin', '=', 'keyword'),
      eb.and([
        eb('articles.source_origin', '=', 'rss'),
        eb('rss_sources.source_type', '=', 'journal'),
      ]),
    ]));
    result = await executeQuery(query, JOURNAL_LIMIT);

  } else if (type === 'blog_news') {
    const query = buildBaseQuery().where((eb) => eb.or([
      eb.and([
        eb('articles.source_origin', '=', 'rss'),
        eb('rss_sources.source_type', 'in', ['blog', 'news']),
      ]),
      eb('articles.source_origin', '=', 'email'),
      eb('articles.source_origin', '=', 'web'),
    ]));
    result = await executeQuery(query, BLOG_NEWS_LIMIT);

  } else {
    // type === 'all' || undefined: journal priority, then blog/news
    const journalQuery = buildBaseQuery().where((eb) => eb.or([
      eb('articles.source_origin', '=', 'journal'),
      eb('articles.source_origin', '=', 'keyword'),
      eb.and([
        eb('articles.source_origin', '=', 'rss'),
        eb('rss_sources.source_type', '=', 'journal'),
      ]),
    ]));
    const journalArticles = await executeQuery(journalQuery, ALL_JOURNAL_PRIORITY);

    const remainingCount = ALL_TOTAL_LIMIT - journalArticles.length;
    let blogNewsArticles: DailySummaryArticle[] = [];

    if (remainingCount > 0) {
      const blogNewsQuery = buildBaseQuery().where((eb) => eb.or([
        eb.and([
          eb('articles.source_origin', '=', 'rss'),
          eb('rss_sources.source_type', 'in', ['blog', 'news']),
        ]),
        eb('articles.source_origin', '=', 'email'),
        eb('articles.source_origin', '=', 'web'),
      ]));
      blogNewsArticles = await executeQuery(blogNewsQuery, remainingCount);
    }

    result = [...journalArticles, ...blogNewsArticles];
  }

  // Sort by source type priority for consistency
  result.sort((a, b) => {
    const priorityA = (SOURCE_TYPE_PRIORITY as Record<string, number>)[a.source_type] ?? 999;
    const priorityB = (SOURCE_TYPE_PRIORITY as Record<string, number>)[b.source_type] ?? 999;
    return priorityA - priorityB;
  });

  log.info({ userId, date: dateStr, count: result.length, type }, 'Fetched daily articles for summary');

  return result;
}

/**
 * Save a daily summary to the database (upsert)
 */
export async function saveDailySummary(input: SaveDailySummaryInput): Promise<void> {
  const db = getDb();
  const { userId, date, type, articleCount, summaryContent, articlesData } = input;

  const articlesJson = JSON.stringify(articlesData);

  await db
    .insertInto('daily_summaries')
    .values({
      user_id: userId,
      summary_date: date,
      summary_type: type,
      article_count: articleCount,
      summary_content: summaryContent,
      articles_data: articlesJson,
    })
    .onConflict((oc) =>
      oc.columns(['user_id', 'summary_date', 'summary_type']).doUpdateSet({
        article_count: articleCount,
        summary_content: summaryContent,
        articles_data: articlesJson,
      })
    )
    .execute();

  log.info({ userId, date, type, articleCount }, 'Daily summary saved');
}

/**
 * Get a daily summary by date and optional type
 */
export async function getDailySummaryByDate(
  userId: number,
  date: string,
  type?: SummaryType
): Promise<DailySummariesSelection | undefined> {
  const db = getDb();
  let query = db
    .selectFrom('daily_summaries')
    .where('user_id', '=', userId)
    .where('summary_date', '=', date);

  if (type) {
    query = query.where('summary_type', '=', type);
  }

  return query.selectAll().executeTakeFirst();
}

/**
 * Get daily summary history list
 */
export async function getDailySummaryHistory(
  userId: number,
  limit: number = 30,
  type?: SummaryType
): Promise<DailySummaryHistoryItem[]> {
  const db = getDb();
  let query = db
    .selectFrom('daily_summaries')
    .where('user_id', '=', userId);

  if (type) {
    query = query.where('summary_type', '=', type);
  }

  const results = await query
    .selectAll()
    .orderBy('summary_date', 'desc')
    .limit(limit)
    .execute();

  return results.map((row) => ({
    id: row.id,
    summary_date: row.summary_date,
    summary_type: row.summary_type as SummaryType,
    article_count: row.article_count,
    summary_content: row.summary_content,
    created_at: row.created_at,
  }));
}

/**
 * Get today's summary if it exists
 */
export async function getTodaySummary(
  userId: number,
  type?: SummaryType
): Promise<DailySummariesSelection | undefined> {
  const today = await getUserLocalDate(userId);
  return getDailySummaryByDate(userId, today, type);
}

/**
 * Get all journal articles (no filter_status filter, includes non-passed articles)
 * Only gets journal-type articles (source_origin = journal|keyword, or RSS with source_type = journal)
 */
export async function getAllJournalArticles(
  userId: number,
  dateStr: string
): Promise<DailySummaryArticle[]> {
  const db = getDb();

  const timezone = await getUserTimezone(userId);
  const [startDate, endDate] = buildUtcRangeFromLocalDate(dateStr, timezone);

  log.info({ userId, date: dateStr, timezone, startDate, endDate }, 'All journal articles query date range');

  const JOURNAL_ALL_LIMIT = 50;

  const query = db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .where((eb) => eb.or([
      eb('rss_sources.user_id', '=', userId),
      eb('journals.user_id', '=', userId),
      eb('keyword_subscriptions.user_id', '=', userId),
    ]))
    .where('articles.created_at', '>=', startDate)
    .where('articles.created_at', '<=', endDate)
    .where((eb) => eb.or([
      eb('articles.source_origin', '=', 'journal'),
      eb('articles.source_origin', '=', 'keyword'),
      eb.and([
        eb('articles.source_origin', '=', 'rss'),
        eb('rss_sources.source_type', '=', 'journal'),
      ]),
    ]));

  const articles = await query
    .select((eb: any) => [
      'articles.id',
      'articles.title',
      'articles.url',
      'articles.summary',
      'articles.markdown_content',
      'articles.published_at',
      'articles.source_origin',
      eb.fn.coalesce('rss_sources.name', 'journals.name', 'keyword_subscriptions.keyword').as('source_name'),
      eb.fn.coalesce('rss_sources.source_type', eb.val('journal')).as('source_type'),
    ])
    .orderBy('articles.created_at', 'desc')
    .limit(JOURNAL_ALL_LIMIT)
    .execute();

  const result = articles.map((row: any) => {
    let sourceName = row.source_name || '未知来源';
    if (row.source_origin === 'keyword') {
      sourceName = `关键词: ${row.source_name}`;
    }

    return {
      id: row.id,
      title: row.title,
      url: row.url,
      summary: row.summary,
      markdown_content: row.markdown_content,
      source_name: sourceName,
      source_type: row.source_type || 'journal',
      published_at: row.published_at,
    };
  });

  result.sort((a, b) => {
    const priorityA = (SOURCE_TYPE_PRIORITY as Record<string, number>)[a.source_type] ?? 999;
    const priorityB = (SOURCE_TYPE_PRIORITY as Record<string, number>)[b.source_type] ?? 999;
    return priorityA - priorityB;
  });

  log.info({ userId, date: dateStr, count: result.length }, 'Fetched all journal articles for summary');

  return result;
}

/**
 * Get past N days passed articles for insights report
 */
export async function getInsightsArticles(
  userId: number,
  days: number = 15,
  limit: number = 60
): Promise<DailySummaryArticle[]> {
  const db = getDb();
  const { getJournalsWhitelist } = await import('../utils/journals-whitelist.js');
  const whitelist = getJournalsWhitelist();

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(now);
  endDate.setHours(0, 0, 0, 0);

  log.info(
    { userId, days, startDate: startDate.toISOString(), endDate: endDate.toISOString(), whitelist: whitelist.length },
    'Fetching insights articles'
  );

  const articles = await db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .leftJoin('email_sources', 'email_sources.id', 'articles.email_source_id')
    .leftJoin('web_sources', 'web_sources.id', 'articles.web_source_id')
    .where('articles.filter_status', '=', 'passed')
    .where((eb) => eb.or([
      eb('rss_sources.user_id', '=', userId),
      eb('journals.user_id', '=', userId),
      eb('keyword_subscriptions.user_id', '=', userId),
      eb('email_sources.user_id', '=', userId),
      eb('web_sources.user_id', '=', userId),
    ]))
    .where('articles.created_at', '>=', startDate.toISOString())
    .where('articles.created_at', '<', endDate.toISOString())
    .where((eb) => eb.or([
      eb('rss_sources.name', 'in', whitelist),
      eb('journals.name', 'in', whitelist),
    ]))
    .where((eb) => eb.or([
      eb('articles.markdown_content', 'is not', null),
      eb('articles.content', 'is not', null),
    ]))
    .where((eb) => eb.and([
      eb.or([
        eb('articles.markdown_content', 'not like', '%<正>%'),
        eb('articles.markdown_content', 'is', null),
      ]),
      eb.or([
        eb('articles.content', 'not like', '%<正>%'),
        eb('articles.content', 'is', null),
      ]),
    ]))
    .select((eb: any) => [
      'articles.id',
      'articles.title',
      'articles.url',
      'articles.summary',
      'articles.markdown_content',
      'articles.published_at',
      'articles.source_origin',
      eb.fn.coalesce('rss_sources.name', 'journals.name', 'keyword_subscriptions.keyword', 'email_sources.name', 'web_sources.name').as('source_name'),
      eb.fn.coalesce('rss_sources.source_type', 'web_sources.source_type', eb.val('journal')).as('source_type'),
    ])
    .orderBy('articles.created_at', 'desc')
    .limit(limit)
    .execute();

  const result = articles.map((row: any) => {
    let sourceName = row.source_name || '未知来源';
    if (row.source_origin === 'keyword') {
      sourceName = `关键词: ${row.source_name}`;
    }
    if (row.source_origin === 'email') {
      sourceName = row.source_name || sourceName;
    }
    if (row.source_origin === 'web') {
      sourceName = row.source_name || sourceName;
    }

    let sourceType = row.source_type || 'journal';
    if (row.source_origin === 'email') {
      sourceType = 'email';
    }

    return {
      id: row.id,
      title: row.title,
      url: row.url,
      summary: row.summary,
      markdown_content: row.markdown_content,
      source_name: sourceName,
      source_type: sourceType,
      published_at: row.published_at,
    };
  });

  log.info({ userId, count: result.length }, 'Fetched insights articles');

  return result;
}
