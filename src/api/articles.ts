/**
 * Articles CRUD Service
 *
 * Database operations for article management.
 * Provides article storage with URL deduplication.
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';
import type { RSSFeedItem } from '../rss-parser.js';
import { toSimpleMarkdown } from '../utils/markdown.js';
import { search, SearchMode } from '../vector/search.js';

const log = logger.child({ module: 'articles-service' });

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
  rss_source_id: number;
  rss_source_name?: string;
  title: string;
  url: string;
  summary: string | null;
  content: string | null;
  markdown_content: string | null;
  filter_status: 'pending' | 'passed' | 'rejected';
  filter_score: number | null;
  filtered_at: string | null;
  process_status: 'pending' | 'processing' | 'completed' | 'failed';
  processed_at: string | null;
  published_at: string | null;
  error_message: string | null;
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
  matchedKeywords: string[];
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
  rss_source_name?: string;
  score: number;
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
      // Check if already exists by (rss_source_id, title) combination
      const exists = await db
        .selectFrom('articles')
        .where('rss_source_id', '=', rssSourceId)
        .where('title', '=', item.title)
        .select('id')
        .executeTakeFirst();

      if (exists) {
        continue;
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
          url: item.link,
          // RSS 入库阶段不生成摘要（由后续 AI 分析生成）
          summary: null,
          // content 保存原始 RSS 文本，markdown_content 保存清洗后的 Markdown
          content: rawContent || null,
          markdown_content: markdown || null,
          filter_status: 'pending',
          process_status: 'pending',
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          created_at: now,
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
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('articles.id', '=', id)
    .where('rss_sources.user_id', '=', userId)
    .select([
      'articles.id',
      'articles.rss_source_id',
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
      'articles.error_message',
      'articles.created_at',
      'articles.updated_at',
      'rss_sources.name as rss_source_name',
    ])
    .executeTakeFirst();

  return article as ArticleWithSource | undefined;
}

/**
 * 获取文章关联关键词（LLM 关键词）
 */
export async function getArticleKeywordsById(
  articleId: number,
  userId: number
): Promise<string[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('article_keywords')
    .innerJoin('keywords', 'keywords.id', 'article_keywords.keyword_id')
    .innerJoin('articles', 'articles.id', 'article_keywords.article_id')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('article_keywords.article_id', '=', articleId)
    .where('rss_sources.user_id', '=', userId)
    .select(['keywords.keyword'])
    .orderBy('keywords.keyword', 'asc')
    .execute();

  return rows.map((r) => r.keyword);
}

/**
 * 写入文章关键词（去重）
 */
export async function upsertArticleKeywords(
  articleId: number,
  userId: number,
  keywords: string[]
): Promise<void> {
  const db = getDb();
  const article = await getArticleById(articleId, userId);
  if (!article) {
    throw new Error('Article not found');
  }

  const uniqueKeywords = normalizeKeywords(keywords);
  if (uniqueKeywords.length === 0) return;

  await db.transaction().execute(async (trx) => {
    for (const keyword of uniqueKeywords) {
      await trx
        .insertInto('keywords')
        .values({
          keyword,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .onConflict((oc) => oc.column('keyword').doNothing())
        .execute();

      const keywordRow = await trx
        .selectFrom('keywords')
        .select(['id'])
        .where('keyword', '=', keyword)
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('article_keywords')
        .values({
          article_id: articleId,
          keyword_id: keywordRow.id,
          created_at: new Date().toISOString(),
        })
        .onConflict((oc) => oc.columns(['article_id', 'keyword_id']).doNothing())
        .execute();
    }
  });
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
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('topic_domains', 'topic_domains.id', 'article_filter_logs.domain_id')
    .where('article_filter_logs.article_id', '=', articleId)
    .where('rss_sources.user_id', '=', userId)
    .where('article_filter_logs.is_passed', '=', 1)
    .select([
      'article_filter_logs.domain_id as domainId',
      'topic_domains.name as domainName',
      'article_filter_logs.is_passed as isPassed',
      'article_filter_logs.relevance_score as relevanceScore',
      'article_filter_logs.matched_keywords as matchedKeywords',
      'article_filter_logs.filter_reason as filterReason',
    ])
    .orderBy('article_filter_logs.id', 'asc')
    .execute();

  return rows.map((row) => ({
    domainId: row.domainId ?? null,
    domainName: row.domainName ?? null,
    isPassed: Number(row.isPassed) === 1,
    relevanceScore: row.relevanceScore ?? null,
    matchedKeywords: safeParseJsonArray(row.matchedKeywords),
    filterReason: row.filterReason ?? null,
  }));
}

/**
 * 获取过滤匹配关键词（用于 LLM 关键词兜底）
 */
export async function getArticleFilterMatchedKeywords(
  articleId: number,
  userId: number
): Promise<string[]> {
  const matches = await getArticleFilterMatches(articleId, userId);
  const keywords = matches.flatMap((m) => m.matchedKeywords || []);
  return normalizeKeywords(keywords);
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
    filterStatus?: 'pending' | 'passed' | 'rejected';
    processStatus?: 'pending' | 'processing' | 'completed' | 'failed';
    search?: string;
    page?: number;
    limit?: number;
  } = {}
): Promise<PaginatedArticlesResult> {
  const db = getDb();
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  let query = db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId);

  if (options.rssSourceId !== undefined) {
    query = query.where('articles.rss_source_id', '=', options.rssSourceId);
  }

  if (options.filterStatus !== undefined) {
    query = query.where('articles.filter_status', '=', options.filterStatus);
  }

  if (options.processStatus !== undefined) {
    query = query.where('articles.process_status', '=', options.processStatus);
  }

  if (options.search !== undefined && options.search.trim() !== '') {
    const searchTerm = `%${options.search.trim()}%`;
    query = query.where((eb) => eb.or([
      eb('articles.title', 'like', searchTerm),
      eb('articles.summary', 'like', searchTerm),
    ]));
  }

  // Get total count
  const totalCountResult = await query
    .select((eb) => eb.fn.count('articles.id').as('count'))
    .executeTakeFirst();

  const total = Number(totalCountResult?.count ?? 0);

  // Get paginated results
  const articles = await query
    .select([
      'articles.id',
      'articles.rss_source_id',
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
      'articles.error_message',
      'articles.created_at',
      'articles.updated_at',
      'rss_sources.name as rss_source_name',
    ])
    .orderBy('articles.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    articles: articles as ArticleWithSource[],
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
    await db
      .updateTable('articles')
      .set({
        filter_status: update.status,
        filter_score: update.score ?? null,
        filtered_at: now,
        updated_at: now,
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
    .where('rss_source_id', 'in', (eb) =>
      eb
        .selectFrom('rss_sources')
        .select('id')
        .where('user_id', '=', userId)
    )
    .executeTakeFirst();

  if (result.numDeletedRows === 0) {
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

function normalizeKeywords(keywords: string[]): string[] {
  const unique = new Set<string>();
  for (const kw of keywords) {
    const cleaned = kw.trim();
    if (cleaned.length === 0) continue;
    unique.add(cleaned);
  }
  return Array.from(unique);
}

function safeParseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
