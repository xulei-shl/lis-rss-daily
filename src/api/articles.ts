/**
 * Articles CRUD Service
 *
 * Database operations for article management.
 * Provides article storage with URL deduplication.
 */

import { getDb, type DatabaseTable } from '../db.js';
import { logger } from '../logger.js';
import type { RSSFeedItem } from '../rss-parser.js';
import { toSimpleMarkdown } from '../utils/markdown.js';
import { generateNormalizedTitle } from '../utils/title.js';
import { search, SearchMode } from '../vector/search.js';
import { getUserTimezone, buildUtcRangeFromLocalDate } from './timezone.js';
import { normalizeDateFields } from '../utils/datetime.js';

const log = logger.child({ module: 'articles-service' });

const ARTICLE_DATE_FIELDS: Array<keyof ArticleWithSource> = [
  'created_at',
  'updated_at',
  'filtered_at',
  'processed_at',
  'published_at',
];

/**
 * Create article input
 */
export interface CreateArticleInput {
  rssSourceId: number;
  title: string;
  url: string;
  summary?: string;
  content?: string;
  publishedAt?: string;
}

/**
 * Article record with RSS source name
 */
export interface ArticleWithSource {
  id: number;
  rss_source_id: number | null;
  journal_id: number | null;
  rss_source_name?: string;
  journal_name?: string;
  source_name?: string;  // 合并后的来源名称
  title: string;
  url: string;
  summary: string | null;
  content: string | null;
  markdown_content: string | null;
  summary_zh: string | null;  // 翻译摘要
  filter_status: 'pending' | 'passed' | 'rejected';
  filter_score: number | null;
  filtered_at: string | null;
  process_status: 'pending' | 'processing' | 'completed' | 'failed';
  process_stages: string | null;  // 步骤状态 JSON
  processed_at: string | null;
  published_at: string | null;
  published_year: number | null;    // 年份（期刊文章使用）
  published_issue: number | null;   // 期号（期刊文章使用）
  published_volume: number | null;  // 卷号（期刊文章使用）
  error_message: string | null;
  is_read: number;  // 0 = 未读, 1 = 已读
  source_origin: 'rss' | 'journal';  // 文章来源
  created_at: string;
  updated_at: string;
}

/**
 * Paginated articles result
 */
export interface PaginatedArticlesResult {
  articles: ArticleWithSource[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * 过滤匹配结果（用于导出与详情展示）
 */
export interface ArticleFilterMatch {
  domainId: number | null;
  domainName: string | null;
  isPassed: boolean;
  relevanceScore: number | null;
  filterReason: string | null;
}

/**
 * 翻译结果
 */
export interface ArticleTranslation {
  title_zh: string | null;
  summary_zh: string | null;
  source_lang: string | null;
}

/**
 * 相关文章（用于展示）
 */
export interface RelatedArticle {
  id: number;
  title: string;
  url: string;
  summary: string | null;
  published_at: string | null;
  published_year: number | null;
  published_issue: number | null;
  published_volume: number | null;
  source_origin: 'rss' | 'journal';
  rss_source_name?: string;
  score: number;
}

function normalizeArticleDates<T extends Partial<ArticleWithSource>>(article: T | undefined): T | undefined {
  if (!article) return article;
  normalizeDateFields(article as Record<string, any>, ARTICLE_DATE_FIELDS);
  return article;
}

/**
 * Batch save articles
 * @param rssSourceId - RSS source ID
 * @param items - RSS feed items
 * @returns Number of saved articles and array of saved article IDs
 */
export async function saveArticles(
  rssSourceId: number,
  items: RSSFeedItem[]
): Promise<{ count: number; articleIds: number[] }> {
  const db = getDb();
  const now = new Date().toISOString();
  const savedArticleIds: number[] = [];

  for (const item of items) {
    try {
      // Validate required fields
      if (!item.title || !item.title.trim()) {
        log.warn({ rssSourceId, url: item.link }, 'Article missing title, skipping');
        continue;
      }

      // Generate normalized title for deduplication
      const titleNormalized = generateNormalizedTitle(item.title);

      // Check if title already exists (title-based deduplication)
      if (titleNormalized) {
        const exists = await db
          .selectFrom('articles')
          .where('title_normalized', '=', titleNormalized)
          .select('id')
          .executeTakeFirst();

        if (exists) {
          log.debug(
            { rssSourceId, title: item.title, url: item.link, existingId: exists.id },
            'Article title already exists, skipping'
          );
          continue;
        }
      }

      // Insert new article and return the inserted ID
      const rawContent = chooseBestContent([
        item.content,
        item.description,
        item.contentSnippet,
      ]);
      const markdown = toSimpleMarkdown(rawContent);

      const result = await db
        .insertInto('articles')
        .values({
          rss_source_id: rssSourceId,
          title: item.title,
          title_normalized: titleNormalized,
          url: item.link,
          // RSS 入库阶段不生成摘要（由后续 AI 分析生成）
          summary: null,
          // content 保存原始 RSS 文本，markdown_content 保存清洗后的 Markdown
          content: rawContent || null,
          markdown_content: markdown || null,
          filter_status: 'pending',
          process_status: 'pending',
          created_at: now,
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          is_read: 0,
          source_origin: 'rss',
          updated_at: now,
        })
        .returning('id')
        .executeTakeFirst();

      if (result) {
        savedArticleIds.push(result.id);
      } else {
        log.warn({ rssSourceId, url: item.link }, 'Failed to get inserted article ID');
      }
    } catch (error) {
      // Check if this is a UNIQUE constraint error on URL
      if (error && typeof error === 'object' && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        // URL already exists in a different RSS source - this is expected for cross-source duplicates
        log.debug(
          { rssSourceId, url: item.link, title: item.title },
          'Article URL exists in another RSS source, skipping'
        );
        continue;
      }
      // Log other errors
      log.error({ error, rssSourceId, url: item.link }, 'Failed to save article');
    }
  }

  if (savedArticleIds.length > 0) {
    log.info(
      { rssSourceId, savedCount: savedArticleIds.length, totalItems: items.length },
      'Articles saved'
    );
  }

  return { count: savedArticleIds.length, articleIds: savedArticleIds };
}

/**
 * 选择最有价值的内容来源（优先更长且更丰富的文本）
 */
function chooseBestContent(candidates: Array<string | undefined | null>): string {
  const cleaned = candidates
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .map((c) => c.trim());

  if (cleaned.length === 0) return '';

  let best = cleaned[0];
  let bestScore = scoreContent(best);

  for (const content of cleaned.slice(1)) {
    const score = scoreContent(content);
    if (score > bestScore) {
      best = content;
      bestScore = score;
    }
  }

  return best;
}

/**
 * 简单评分：正文长度 + 去标签长度
 */
function scoreContent(content: string): number {
  const textOnly = content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const lengthScore = textOnly.length;
  const rawScore = content.length * 0.1;
  return lengthScore + rawScore;
}

/**
 * Batch check if articles exist by (rss_source_id, title) combination
 * @param rssSourceId - RSS source ID
 * @param titles - Article titles to check
 * @returns Set of existing titles within this RSS source
 */
export async function checkArticlesExistByTitle(
  rssSourceId: number,
  titles: string[]
): Promise<Set<string>> {
  if (titles.length === 0) {
    return new Set();
  }

  const db = getDb();

  const existing = await db
    .selectFrom('articles')
    .where('rss_source_id', '=', rssSourceId)
    .where('title', 'in', titles)
    .select('title')
    .execute();

  return new Set(existing.map((e) => e.title));
}

/**
 * Batch check if articles exist by URL (fallback method)
 * @param urls - Article URLs
 * @returns Set of existing URLs
 */
export async function checkArticlesExistByURL(urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) {
    return new Set();
  }

  const db = getDb();

  const existing = await db
    .selectFrom('articles')
    .where('url', 'in', urls)
    .select('url')
    .execute();

  return new Set(existing.map((e) => e.url));
}

/**
 * Get article by ID
 * @param id - Article ID
 * @param userId - User ID (for permission check)
 */
export async function getArticleById(
  id: number,
  userId: number
): Promise<ArticleWithSource | undefined> {
  const db = getDb();

  const article = await db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .where('articles.id', '=', id)
    .where((eb) => eb.or([
      eb.and([
        eb('articles.rss_source_id', 'is not', null),
        eb('rss_sources.user_id', '=', userId),
      ]),
      eb.and([
        eb('articles.journal_id', 'is not', null),
        eb('journals.user_id', '=', userId),
      ]),
    ]))
    .select([
      'articles.id',
      'articles.rss_source_id',
      'articles.journal_id',
      'articles.title',
      'articles.url',
      'articles.summary',
      'articles.content',
      'articles.markdown_content',
      'articles.filter_status',
      'articles.filter_score',
      'articles.filtered_at',
      'articles.process_status',
      'articles.processed_at',
      'articles.published_at',
      'articles.published_year',
      'articles.published_issue',
      'articles.published_volume',
      'articles.error_message',
      'articles.is_read',
      'articles.source_origin',
      'articles.created_at',
      'articles.updated_at',
      'rss_sources.name as rss_source_name',
      'journals.name as journal_name',
    ])
    .executeTakeFirst();

  if (!article) return undefined;

  // 合并来源名称
  const merged = {
    ...article,
    source_name: (article as any).journal_name || (article as any).rss_source_name || 'Unknown',
  } as ArticleWithSource;

  normalizeArticleDates(merged);
  return merged;
}


/**
 * 获取过滤匹配结果（含原因）
 */
export async function getArticleFilterMatches(
  articleId: number,
  userId: number
): Promise<ArticleFilterMatch[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('article_filter_logs')
    .innerJoin('articles', 'articles.id', 'article_filter_logs.article_id')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('topic_domains', 'topic_domains.id', 'article_filter_logs.domain_id')
    .where('article_filter_logs.article_id', '=', articleId)
    .where((eb) => eb.or([
      eb.and([
        eb('articles.rss_source_id', 'is not', null),
        eb('rss_sources.user_id', '=', userId),
      ]),
      eb.and([
        eb('articles.journal_id', 'is not', null),
        eb('journals.user_id', '=', userId),
      ]),
    ]))
    .where('article_filter_logs.is_passed', '=', 1)
    .select([
      'article_filter_logs.domain_id as domainId',
      'topic_domains.name as domainName',
      'article_filter_logs.is_passed as isPassed',
      'article_filter_logs.relevance_score as relevanceScore',
      'article_filter_logs.filter_reason as filterReason',
    ])
    .orderBy('article_filter_logs.id', 'asc')
    .execute();

  return rows.map((row) => ({
    domainId: row.domainId ?? null,
    domainName: row.domainName ?? null,
    isPassed: Number(row.isPassed) === 1,
    relevanceScore: row.relevanceScore ?? null,
    filterReason: row.filterReason ?? null,
  }));
}


/**
 * 获取翻译结果
 */
export async function getArticleTranslation(
  articleId: number,
  userId: number
): Promise<ArticleTranslation | null> {
  const db = getDb();
  const article = await getArticleById(articleId, userId);
  if (!article) return null;

  const row = await db
    .selectFrom('article_translations')
    .select(['title_zh', 'summary_zh', 'source_lang'])
    .where('article_id', '=', articleId)
    .executeTakeFirst();

  if (!row) return null;
  return {
    title_zh: row.title_zh ?? null,
    summary_zh: row.summary_zh ?? null,
    source_lang: row.source_lang ?? null,
  };
}

/**
 * 写入翻译结果（覆盖更新）
 */
export async function upsertArticleTranslation(
  articleId: number,
  userId: number,
  translation: ArticleTranslation
): Promise<void> {
  const db = getDb();
  const article = await getArticleById(articleId, userId);
  if (!article) {
    throw new Error('Article not found');
  }

  const now = new Date().toISOString();

  await db
    .insertInto('article_translations')
    .values({
      article_id: articleId,
      title_zh: translation.title_zh ?? null,
      summary_zh: translation.summary_zh ?? null,
      source_lang: translation.source_lang ?? null,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column('article_id').doUpdateSet({
        title_zh: translation.title_zh ?? null,
        summary_zh: translation.summary_zh ?? null,
        source_lang: translation.source_lang ?? null,
        updated_at: now,
      })
    )
    .execute();
}

/**
 * Get user articles with pagination
 * @param userId - User ID
 * @param options - Query options
 */
export async function getUserArticles(
  userId: number,
  options: {
    rssSourceId?: number;
    journalId?: number;
    filterStatus?: 'pending' | 'passed' | 'rejected';
    processStatus?: 'pending' | 'processing' | 'completed' | 'failed';
    search?: string;
    page?: number;
    limit?: number;
    daysAgo?: number;
    /** 爬取日期范围过滤 */
    createdAfter?: string;  // ISO date string (YYYY-MM-DD)
    createdBefore?: string; // ISO date string (YYYY-MM-DD)
    /** 搜索时是否跳过时间过滤（搜索在全量数据中进行，结果显示不受时间限制） */
    skipDaysFilterForSearch?: boolean;
    /** 已读状态过滤 */
    isRead?: boolean;
  } = {}
): Promise<PaginatedArticlesResult> {
  const db = getDb();
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;
  const needsLocalDateFilter = Boolean(options.createdAfter || options.createdBefore);
  const userTimezone = needsLocalDateFilter ? await getUserTimezone(userId) : undefined;

  // 判断是否应该应用时间过滤
  // 如果是搜索模式且启用了 skipDaysFilterForSearch，则不应用时间过滤
  // 日期范围过滤优先于 daysAgo 过滤
  const hasDateRange = options.createdAfter || options.createdBefore;
  const shouldApplyDaysFilter = options.daysAgo !== undefined &&
    !hasDateRange &&
    !(options.skipDaysFilterForSearch && options.search && options.search.trim() !== '');

  // 使用左连接和条件来同时支持 RSS 和期刊文章
  // (rss_source_id IS NOT NULL AND rss_source.user_id = :userId) OR (journal_id IS NOT NULL AND journal.user_id = :userId)
  let query = db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .where((eb) => eb.or([
      eb.and([
        eb('articles.rss_source_id', 'is not', null),
        eb('rss_sources.user_id', '=', userId),
      ]),
      eb.and([
        eb('articles.journal_id', 'is not', null),
        eb('journals.user_id', '=', userId),
      ]),
    ]));

  // 来源筛选：支持 RSS 源或期刊
  // 如果同时提供了 rssSourceId 和 journalId（混合类型），使用 OR 条件
  const hasSourceFilter = options.rssSourceId !== undefined || options.journalId !== undefined;
  if (hasSourceFilter) {
    if (options.rssSourceId !== undefined && options.journalId !== undefined) {
      // 同时筛选 RSS 和期刊（混合类型），使用 OR
      const rssId = options.rssSourceId;
      const journalId = options.journalId;
      query = query.where((eb) => eb.or([
        eb('articles.rss_source_id', '=', rssId),
        eb('articles.journal_id', '=', journalId),
      ]));
    } else if (options.rssSourceId !== undefined) {
      // 仅筛选 RSS
      query = query.where('articles.rss_source_id', '=', options.rssSourceId);
    } else if (options.journalId !== undefined) {
      // 仅筛选期刊
      query = query.where('articles.journal_id', '=', options.journalId);
    }
  }

  if (options.filterStatus !== undefined) {
    query = query.where('articles.filter_status', '=', options.filterStatus);
  }

  if (options.processStatus !== undefined) {
    query = query.where('articles.process_status', '=', options.processStatus);
  }

  if (options.isRead !== undefined) {
    query = query.where('articles.is_read', '=', options.isRead ? 1 : 0);
  }

  if (options.search !== undefined && options.search.trim() !== '') {
    const searchTerm = `%${options.search.trim()}%`;
    query = query.where((eb) => eb.or([
      eb('articles.title', 'like', searchTerm),
      eb('articles.summary', 'like', searchTerm),
    ]));
  }

  // 时间过滤：根据 shouldApplyDaysFilter 决定是否应用
  if (shouldApplyDaysFilter) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo!);
    query = query.where('articles.created_at', '>=', cutoffDate.toISOString());
  }

  // 日期范围过滤（优先级高于 daysAgo）
  if (options.createdAfter) {
    const [startDate] = buildUtcRangeFromLocalDate(options.createdAfter, userTimezone);
    query = query.where('articles.created_at', '>=', startDate);
  }
  if (options.createdBefore) {
    const [, endDate] = buildUtcRangeFromLocalDate(options.createdBefore, userTimezone);
    query = query.where('articles.created_at', '<=', endDate);
  }

  // Get total count
  const totalCountResult = await query
    .select((eb) => eb.fn.count('articles.id').as('count'))
    .executeTakeFirst();

  const total = Number(totalCountResult?.count ?? 0);

  // Build a fresh query for articles with translation left join
  let articlesQuery = db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('article_translations', 'article_translations.article_id', 'articles.id')
    .where((eb) => eb.or([
      eb.and([
        eb('articles.rss_source_id', 'is not', null),
        eb('rss_sources.user_id', '=', userId),
      ]),
      eb.and([
        eb('articles.journal_id', 'is not', null),
        eb('journals.user_id', '=', userId),
      ]),
    ]));

  // Re-apply filters (same logic as above)
  if (hasSourceFilter) {
    if (options.rssSourceId !== undefined && options.journalId !== undefined) {
      // 同时筛选 RSS 和期刊（混合类型），使用 OR
      const rssId = options.rssSourceId;
      const journalId = options.journalId;
      articlesQuery = articlesQuery.where((eb) => eb.or([
        eb('articles.rss_source_id', '=', rssId),
        eb('articles.journal_id', '=', journalId),
      ]));
    } else if (options.rssSourceId !== undefined) {
      // 仅筛选 RSS
      articlesQuery = articlesQuery.where('articles.rss_source_id', '=', options.rssSourceId);
    } else if (options.journalId !== undefined) {
      // 仅筛选期刊
      articlesQuery = articlesQuery.where('articles.journal_id', '=', options.journalId);
    }
  }
  if (options.filterStatus !== undefined) {
    articlesQuery = articlesQuery.where('articles.filter_status', '=', options.filterStatus);
  }
  if (options.processStatus !== undefined) {
    articlesQuery = articlesQuery.where('articles.process_status', '=', options.processStatus);
  }
  if (options.isRead !== undefined) {
    articlesQuery = articlesQuery.where('articles.is_read', '=', options.isRead ? 1 : 0);
  }
  if (options.search !== undefined && options.search.trim() !== '') {
    const searchTerm = `%${options.search.trim()}%`;
    articlesQuery = articlesQuery.where((eb) => eb.or([
      eb('articles.title', 'like', searchTerm),
      eb('articles.summary', 'like', searchTerm),
    ]));
  }

  // 时间过滤：使用相同的 shouldApplyDaysFilter 逻辑
  if (shouldApplyDaysFilter) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo!);
    articlesQuery = articlesQuery.where('articles.created_at', '>=', cutoffDate.toISOString());
  }

  // 日期范围过滤（优先级高于 daysAgo）
  if (options.createdAfter) {
    const [startDate] = buildUtcRangeFromLocalDate(options.createdAfter, userTimezone);
    articlesQuery = articlesQuery.where('articles.created_at', '>=', startDate);
  }
  if (options.createdBefore) {
    const [, endDate] = buildUtcRangeFromLocalDate(options.createdBefore, userTimezone);
    articlesQuery = articlesQuery.where('articles.created_at', '<=', endDate);
  }

  // Get paginated results with translation
  const articles = await articlesQuery
    .select([
      'articles.id',
      'articles.rss_source_id',
      'articles.journal_id',
      'articles.title',
      'articles.url',
      'articles.summary',
      'articles.content',
      'articles.markdown_content',
      'articles.filter_status',
      'articles.filter_score',
      'articles.filtered_at',
      'articles.process_status',
      'articles.processed_at',
      'articles.published_at',
      'articles.published_year',
      'articles.published_issue',
      'articles.published_volume',
      'articles.error_message',
      'articles.is_read',
      'articles.source_origin',
      'articles.created_at',
      'articles.updated_at',
      'rss_sources.name as rss_source_name',
      'journals.name as journal_name',
      'article_translations.summary_zh',
    ])
    .orderBy('articles.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  // 合并来源名称
  const articlesWithSourceName = articles.map((article: any) => ({
    ...article,
    source_name: article.journal_name || article.rss_source_name || 'Unknown',
  }));

  const normalizedArticles = articlesWithSourceName.map((article) => normalizeArticleDates(article)!) as ArticleWithSource[];

  return {
    articles: normalizedArticles,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Batch update article filter status
 * @param updates - Update list
 */
export async function batchUpdateFilterStatus(
  updates: Array<{
    articleId: number;
    status: 'passed' | 'rejected';
    score?: number;
  }>
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  for (const update of updates) {
    // 当文章被拒绝时，自动标记为已读
    const isRead = update.status === 'rejected' ? 1 : undefined;

    await db
      .updateTable('articles')
      .set({
        filter_status: update.status,
        filter_score: update.score ?? null,
        filtered_at: now,
        updated_at: now,
        ...(isRead !== undefined && { is_read: isRead }),
      })
      .where('id', '=', update.articleId)
      .execute();
  }

  log.info({ count: updates.length }, 'Batch updated article filter status');
}

/**
 * Update article process status
 * @param articleId - Article ID
 * @param status - Process status
 * @param errorMessage - Error message (if failed)
 */
export async function updateArticleProcessStatus(
  articleId: number,
  status: 'processing' | 'completed' | 'failed',
  errorMessage?: string
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  await db
    .updateTable('articles')
    .set({
      process_status: status,
      processed_at: now,
      updated_at: now,
      ...(errorMessage && { error_message: errorMessage }),
    })
    .where('id', '=', articleId)
    .execute();
}

/**
 * Delete article by ID
 * @param id - Article ID
 * @param userId - User ID (for permission check)
 */
export async function deleteArticle(id: number, userId: number): Promise<void> {
  const db = getDb();

  const result = await db
    .deleteFrom('articles')
    .where('id', '=', id)
    .where((eb) => eb.or([
      eb.and([
        eb('articles.rss_source_id', 'is not', null),
        eb('articles.rss_source_id', 'in', (eb) =>
          eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId)
        ),
      ]),
      eb.and([
        eb('articles.journal_id', 'is not', null),
        eb('articles.journal_id', 'in', (eb) =>
          eb.selectFrom('journals').select('id').where('user_id', '=', userId)
        ),
      ]),
    ]))
    .executeTakeFirst();

  if (result.numDeletedRows === 0n) {
    throw new Error('Article not found');
  }

  log.info({ articleId: id, userId }, 'Article deleted');
}

/**
 * 获取相关文章（优先缓存，不足时计算并写回）
 */
export async function getRelatedArticles(
  articleId: number,
  userId: number,
  limit: number = 5
): Promise<RelatedArticle[]> {
  const response = await search({
    mode: SearchMode.RELATED,
    userId,
    articleId,
    limit,
    normalizeScores: false,
    useCache: true,
  });

  return response.results.map((r) => ({
    id: r.articleId,
    title: r.metadata?.title || '',
    url: r.metadata?.url || '',
    summary: r.metadata?.summary ?? null,
    published_at: r.metadata?.published_at ?? null,
    rss_source_name: r.metadata?.rss_source_name,
    score: r.score,
  }));
}

/**
 * 重新计算并写入相关文章缓存（用于流水线）
 */
export async function refreshRelatedArticles(
  articleId: number,
  userId: number,
  limit: number = 5
): Promise<RelatedArticle[]> {
  const response = await search({
    mode: SearchMode.RELATED,
    userId,
    articleId,
    limit,
    normalizeScores: false,
    useCache: false,
    refreshCache: true,
  });

  return response.results.map((r) => ({
    id: r.articleId,
    title: r.metadata?.title || '',
    url: r.metadata?.url || '',
    summary: r.metadata?.summary ?? null,
    published_at: r.metadata?.published_at ?? null,
    rss_source_name: r.metadata?.rss_source_name,
    score: r.score,
  }));
}

/**
 * 更新文章已读状态
 * @param articleId - Article ID
 * @param userId - User ID (for permission check)
 * @param isRead - Read status
 */
export async function updateArticleReadStatus(
  articleId: number,
  userId: number,
  isRead: boolean
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  const result = await db
    .updateTable('articles')
    .set({
      is_read: isRead ? 1 : 0,
      updated_at: now,
    })
    .where('id', '=', articleId)
    .where((eb) => eb.or([
      eb.and([
        eb('articles.rss_source_id', 'is not', null),
        eb('articles.rss_source_id', 'in', (eb) =>
          eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId)
        ),
      ]),
      eb.and([
        eb('articles.journal_id', 'is not', null),
        eb('articles.journal_id', 'in', (eb) =>
          eb.selectFrom('journals').select('id').where('user_id', '=', userId)
        ),
      ]),
    ]))
    .executeTakeFirst();

  if (result.numUpdatedRows === 0n) {
    throw new Error('Article not found');
  }

  log.info({ articleId, userId, isRead }, 'Article read status updated');
}

/**
 * 批量更新文章已读状态
 * @param userId - User ID
 * @param articleIds - Article IDs to update
 * @param isRead - Read status
 * @returns Number of updated articles
 */
export async function batchUpdateArticleReadStatus(
  userId: number,
  articleIds: number[],
  isRead: boolean
): Promise<number> {
  if (articleIds.length === 0) return 0;

  const db = getDb();
  const now = new Date().toISOString();

  const result = await db
    .updateTable('articles')
    .set({
      is_read: isRead ? 1 : 0,
      updated_at: now,
    })
    .where('id', 'in', articleIds)
    .where((eb) => eb.or([
      eb.and([
        eb('articles.rss_source_id', 'is not', null),
        eb('articles.rss_source_id', 'in', (eb) =>
          eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId)
        ),
      ]),
      eb.and([
        eb('articles.journal_id', 'is not', null),
        eb('articles.journal_id', 'in', (eb) =>
          eb.selectFrom('journals').select('id').where('user_id', '=', userId)
        ),
      ]),
    ]))
    .executeTakeFirst();

  const count = Number(result.numUpdatedRows);
  log.info({ count, userId, isRead }, 'Batch updated article read status');
  return count;
}

/**
 * 批量标记所有未读文章为已读
 * @param userId - User ID
 * @param options - Filter options (filterStatus, daysAgo, rssSourceId, journalId, etc.)
 * @returns Number of updated articles
 */
export async function markAllAsRead(
  userId: number,
  options: {
    filterStatus?: 'pending' | 'passed' | 'rejected';
    daysAgo?: number;
    rssSourceId?: number;
    journalId?: number;
    processStatus?: 'pending' | 'processing' | 'completed' | 'failed';
    isRead?: boolean;
    search?: string;
    createdAfter?: string;
    createdBefore?: string;
  } = {}
): Promise<number> {
  const db = getDb();
  const now = new Date().toISOString();
  const needsLocalDateFilter = Boolean(options.createdAfter || options.createdBefore);
  const userTimezone = needsLocalDateFilter ? await getUserTimezone(userId) : undefined;

  // 使用左连接同时支持 RSS 和期刊文章
  let query = db
    .updateTable('articles')
    .set({
      is_read: 1,
      updated_at: now,
    })
    .where((eb) => eb.or([
      eb.and([
        eb('articles.rss_source_id', 'is not', null),
        eb('articles.rss_source_id', 'in', (eb) =>
          eb.selectFrom('rss_sources').select('id').where('user_id', '=', userId)
        ),
      ]),
      eb.and([
        eb('articles.journal_id', 'is not', null),
        eb('articles.journal_id', 'in', (eb) =>
          eb.selectFrom('journals').select('id').where('user_id', '=', userId)
        ),
      ]),
    ]))
    .where('is_read', '=', 0);

  if (options.filterStatus !== undefined) {
    query = query.where('filter_status', '=', options.filterStatus);
  }

  if (options.rssSourceId !== undefined) {
    query = query.where('rss_source_id', '=', options.rssSourceId);
  }

  if (options.journalId !== undefined) {
    query = query.where('journal_id', '=', options.journalId);
  }

  if (options.processStatus !== undefined) {
    query = query.where('process_status', '=', options.processStatus);
  }

  if (options.daysAgo !== undefined) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo);
    query = query.where('created_at', '>=', cutoffDate.toISOString());
  }

  if (options.createdAfter) {
    const [startDate] = buildUtcRangeFromLocalDate(options.createdAfter, userTimezone);
    query = query.where('created_at', '>=', startDate);
  }

  if (options.createdBefore) {
    const [, endDate] = buildUtcRangeFromLocalDate(options.createdBefore, userTimezone);
    query = query.where('created_at', '<=', endDate);
  }

  // 注意：搜索功能暂时不支持，因为 UPDATE 语句不支持 LIKE 查询
  // 如果需要，可以先查询出符合条件的文章 ID，再批量更新

  const result = await query.executeTakeFirst();
  const count = Number(result.numUpdatedRows);
  log.info({ count, userId, options }, 'Marked all articles as read');
  return count;
}

/**
 * 获取未读文章数量
 * @param userId - User ID
 * @param options - Filter options
 */
export async function getUnreadCount(
  userId: number,
  options: {
    filterStatus?: 'pending' | 'passed' | 'rejected';
    daysAgo?: number;
  } = {}
): Promise<number> {
  const db = getDb();

  let query = db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .where((eb) => eb.or([
      eb.and([
        eb('articles.rss_source_id', 'is not', null),
        eb('rss_sources.user_id', '=', userId),
      ]),
      eb.and([
        eb('articles.journal_id', 'is not', null),
        eb('journals.user_id', '=', userId),
      ]),
    ]))
    .where('articles.is_read', '=', 0);

  if (options.filterStatus !== undefined) {
    query = query.where('articles.filter_status', '=', options.filterStatus);
  }

  if (options.daysAgo !== undefined) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - options.daysAgo);
    query = query.where('articles.created_at', '>=', cutoffDate.toISOString());
  }

  const result = await query
    .select((eb) => eb.fn.count('articles.id').as('count'))
    .executeTakeFirst();

  return Number(result?.count || 0);
}

/**
 * 合并来源选项接口
 */
export interface MergedSourceOption {
  id: string;           // 格式: "rss:{id}" 或 "journal:{id}" 或 "mixed:{id}"
  name: string;         // 来源名称
  type: 'rss' | 'journal' | 'mixed';
  rssIds?: number[];    // 当 name 相同时，包含多个 RSS ID
  journalIds?: number[]; // 当 name 相同时，包含多个期刊 ID
}

/**
 * 获取合并后的来源列表（RSS 源和期刊按名称合并）
 * @param userId - User ID
 */
export async function getMergedSources(userId: number): Promise<MergedSourceOption[]> {
  const db = getDb();

  // 获取 RSS 源列表
  const rssSources = await db
    .selectFrom('rss_sources')
    .select(['id', 'name'])
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .execute();

  // 获取期刊列表
  const journals = await db
    .selectFrom('journals')
    .select(['id', 'name'])
    .where('user_id', '=', userId)
    .where('status', '=', 'active')
    .execute();

  // 按名称分组
  const sourceMap = new Map<string, MergedSourceOption>();

  // 添加 RSS 源
  for (const source of rssSources) {
    const existing = sourceMap.get(source.name);
    if (existing) {
      if (existing.type === 'rss') {
        existing.rssIds = existing.rssIds || [];
        existing.rssIds.push(source.id);
      } else {
        // 已有期刊，需要转换为混合类型
        existing.journalIds = existing.journalIds || [];
        existing.rssIds = existing.rssIds || [];
        existing.rssIds.push(source.id);
        existing.type = 'mixed';
        existing.id = `mixed:${existing.journalIds[0]}`;
      }
    } else {
      sourceMap.set(source.name, {
        id: `rss:${source.id}`,
        name: source.name,
        type: 'rss',
        rssIds: [source.id],
      });
    }
  }

  // 添加期刊
  for (const journal of journals) {
    const existing = sourceMap.get(journal.name);
    if (existing) {
      if (existing.type === 'journal') {
        existing.journalIds = existing.journalIds || [];
        existing.journalIds.push(journal.id);
      } else {
        // 已有 RSS，需要转换
        existing.rssIds = existing.rssIds || [];
        existing.journalIds = existing.journalIds || [];
        existing.journalIds.push(journal.id);
        existing.type = 'mixed'; // 混合类型
        existing.id = `mixed:${journal.id}`; // 更新 ID
      }
    } else {
      sourceMap.set(journal.name, {
        id: `journal:${journal.id}`,
        name: journal.name,
        type: 'journal',
        journalIds: [journal.id],
      });
    }
  }

  // 按名称排序
  return Array.from(sourceMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

