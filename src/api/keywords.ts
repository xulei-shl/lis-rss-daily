/**
 * Keywords API Service
 * 关键词订阅管理服务
 */

import { getDb, type KeywordSubscriptionsSelection, type KeywordCrawlLogsSelection, type ArticlesSelection } from '../db.js';
import { logger } from '../logger.js';
import { googleScholarSpider } from '../spiders/google-scholar-spider.js';
import { generateNormalizedTitle } from '../utils/title.js';
import { filterArticle } from '../filter.js';
import { processArticle } from '../pipeline.js';

const log = logger.child({ module: 'keywords-api' });

/**
 * 关键词创建参数
 */
export interface CreateKeywordParams {
  userId: number;
  keyword: string;
  yearStart?: number;
  yearEnd?: number;
  spiderType?: 'google_scholar' | 'cnki';
  numResults?: number;
  isActive?: boolean;
}

/**
 * 关键词更新参数
 */
export interface UpdateKeywordParams {
  keyword?: string;
  yearStart?: number | null;
  yearEnd?: number | null;
  spiderType?: 'google_scholar' | 'cnki';
  numResults?: number;
  isActive?: boolean;
}

/**
 * 关键词列表查询参数
 */
export interface ListKeywordsParams {
  userId: number;
  isActive?: boolean;
  spiderType?: string;
  page?: number;
  limit?: number;
}

/**
 * 关键词列表分页结果
 */
export interface ListKeywordsResult {
  keywords: KeywordSubscriptionsSelection[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * 爬取日志参数
 */
export interface KeywordCrawlLogParams {
  keywordId: number;
  keyword: string;
  spiderType: string;
  yearStart?: number;
  yearEnd?: number;
  articlesCount: number;
  newArticlesCount: number;
  status: 'success' | 'failed' | 'partial';
  errorMessage?: string;
  durationMs?: number;
}

/**
 * 获取活跃关键词列表
 */
export async function getActiveKeywords(userId: number): Promise<KeywordInfo[]> {
  const db = getDb();

  const keywords = await db
    .selectFrom('keyword_subscriptions')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .selectAll()
    .execute();

  return keywords as KeywordInfo[];
}

/**
 * 获取关键词列表（支持分页）
 */
export async function listKeywords(params: ListKeywordsParams): Promise<ListKeywordsResult> {
  const db = getDb();

  const page = params.page || 1;
  const limit = params.limit || 10;
  const offset = (page - 1) * limit;

  let query = db
    .selectFrom('keyword_subscriptions')
    .where('user_id', '=', params.userId);

  if (params.isActive !== undefined) {
    query = query.where('is_active', '=', params.isActive ? 1 : 0);
  }

  if (params.spiderType) {
    query = query.where('spider_type', '=', params.spiderType as 'google_scholar' | 'cnki');
  }

  // 获取总数
  const countResult = await query
    .select((eb) => [eb.fn.count('id').as('total')])
    .executeTakeFirst();

  const total = Number(countResult?.total || 0);
  const totalPages = Math.ceil(total / limit);

  // 获取分页数据
  const keywords = await query
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    keywords,
    page,
    limit,
    total,
    totalPages,
  };
}

/**
 * 获取单个关键词
 */
export async function getKeyword(userId: number, keywordId: number): Promise<KeywordSubscriptionsSelection | null> {
  const db = getDb();

  const keyword = await db
    .selectFrom('keyword_subscriptions')
    .where('id', '=', keywordId)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();

  return keyword || null;
}

/**
 * 创建关键词订阅
 */
export async function createKeyword(params: CreateKeywordParams): Promise<KeywordSubscriptionsSelection> {
  const db = getDb();

  const { userId, keyword, yearStart, yearEnd, spiderType = 'google_scholar', numResults = 20, isActive = true } = params;

  // 插入数据库
  const result = await db
    .insertInto('keyword_subscriptions')
    .values({
      user_id: userId,
      keyword: keyword.trim(),
      year_start: yearStart || null,
      year_end: yearEnd || null,
      spider_type: spiderType,
      num_results: numResults,
      is_active: isActive ? 1 : 0,
      crawl_count: 0,
      total_articles: 0,
      updated_at: new Date().toISOString()
    })
    .executeTakeFirstOrThrow();

  // 返回完整记录
  const inserted = await db
    .selectFrom('keyword_subscriptions')
    .where('id', '=', Number(result.insertId))
    .selectAll()
    .executeTakeFirstOrThrow();

  log.info({ keywordId: inserted.id, keyword: inserted.keyword }, 'Keyword subscription created');
  return inserted;
}

/**
 * 更新关键词订阅
 */
export async function updateKeyword(userId: number, keywordId: number, params: UpdateKeywordParams): Promise<KeywordSubscriptionsSelection | null> {
  const db = getDb();

  const existing = await getKeyword(userId, keywordId);
  if (!existing) {
    return null;
  }

  // 构建更新数据
  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString()
  };

  if (params.keyword !== undefined) {
    updateData.keyword = params.keyword.trim();
  }

  if (params.yearStart !== undefined) {
    updateData.year_start = params.yearStart;
  }

  if (params.yearEnd !== undefined) {
    updateData.year_end = params.yearEnd;
  }

  if (params.spiderType !== undefined) {
    updateData.spider_type = params.spiderType;
  }

  if (params.numResults !== undefined) {
    updateData.num_results = params.numResults;
  }

  if (params.isActive !== undefined) {
    updateData.is_active = params.isActive ? 1 : 0;
  }

  // 执行更新
  await db
    .updateTable('keyword_subscriptions')
    .set(updateData)
    .where('id', '=', keywordId)
    .where('user_id', '=', userId)
    .execute();

  // 返回更新后的记录
  const updated = await getKeyword(userId, keywordId);
  log.info({ keywordId, updates: Object.keys(updateData) }, 'Keyword subscription updated');
  return updated;
}

/**
 * 删除关键词订阅
 */
export async function deleteKeyword(userId: number, keywordId: number): Promise<boolean> {
  const db = getDb();

  const existing = await getKeyword(userId, keywordId);
  if (!existing) {
    return false;
  }

  const result = await db
    .deleteFrom('keyword_subscriptions')
    .where('id', '=', keywordId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  log.info({ keywordId }, 'Keyword subscription deleted');
  return result.numDeletedRows > 0;
}

/**
 * 爬取单个关键词
 */
export async function crawlKeyword(keywordId: number): Promise<{
  success: boolean;
  articlesCount: number;
  newArticlesCount: number;
  error?: string;
}> {
  const db = getDb();
  const startTime = Date.now();

  try {
    // 获取关键词配置
    const keyword = await db
      .selectFrom('keyword_subscriptions')
      .where('id', '=', keywordId)
      .selectAll()
      .executeTakeFirst();

    if (!keyword) {
      throw new Error(`Keyword subscription ${keywordId} not found`);
    }

    const yearStart = keyword.year_start || undefined;
    const yearEnd = keyword.year_end || undefined;

    log.info({
      keywordId,
      keyword: keyword.keyword,
      yearStart,
      yearEnd,
      numResults: keyword.num_results
    }, 'Starting keyword crawl');

    // 调用爬虫
    const spiderResult = await googleScholarSpider.search({
      keyword: keyword.keyword,
      yearStart,
      yearEnd,
      numResults: keyword.num_results
    });

    if (!spiderResult.success) {
      throw new Error(spiderResult.error || 'Spider failed');
    }

    // 保存文章到数据库
    const { savedCount, newCount } = await saveArticles(keywordId, spiderResult.articles);

    // 更新关键词状态
    await updateKeywordCrawlStatus(keywordId, savedCount, newCount);

    // 创建爬取日志
    const durationMs = Date.now() - startTime;
    await createKeywordCrawlLog({
      keywordId,
      keyword: keyword.keyword,
      spiderType: keyword.spider_type,
      yearStart,
      yearEnd,
      articlesCount: savedCount,
      newArticlesCount: newCount,
      status: 'success',
      durationMs
    });

    log.info({
      keywordId,
      savedCount,
      newCount,
      durationMs
    }, 'Keyword crawl completed');

    return {
      success: true,
      articlesCount: savedCount,
      newArticlesCount: newCount
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.error({ keywordId, error: errorMessage, durationMs }, 'Keyword crawl failed');

    // 记录失败日志
    try {
      const keyword = await db
        .selectFrom('keyword_subscriptions')
        .where('id', '=', keywordId)
        .selectAll()
        .executeTakeFirst();

      if (keyword) {
        await createKeywordCrawlLog({
          keywordId,
          keyword: keyword.keyword,
          spiderType: keyword.spider_type,
          yearStart: keyword.year_start || undefined,
          yearEnd: keyword.year_end || undefined,
          articlesCount: 0,
          newArticlesCount: 0,
          status: 'failed',
          errorMessage,
          durationMs
        });
      }
    } catch (logError) {
      log.error({ error: logError }, 'Failed to create crawl log');
    }

    return {
      success: false,
      articlesCount: 0,
      newArticlesCount: 0,
      error: errorMessage
    };
  }
}

/**
 * 保存文章到数据库（带查重）
 */
async function saveArticles(
  keywordId: number,
  articles: import('../spiders/types.js').CrawledArticle[]
): Promise<{ savedCount: number; newCount: number }> {
  const db = getDb();
  let savedCount = 0;
  let newCount = 0;

  for (const article of articles) {
    try {
      // 查重：URL 查重
      const existingByUrl = await db
        .selectFrom('articles')
        .where('url', '=', article.url)
        .select('id')
        .executeTakeFirst();

      if (existingByUrl) {
        log.debug({ url: article.url }, 'Article already exists (URL)');
        continue;
      }

      // 查重：title_normalized 查重
      const titleNormalized = generateNormalizedTitle(article.title);
      const existingByTitle = titleNormalized ? await db
        .selectFrom('articles')
        .where('title_normalized', '=', titleNormalized)
        .select('id')
        .executeTakeFirst() : null;

      if (existingByTitle) {
        log.debug({ title: article.title }, 'Article already exists (title)');
        continue;
      }

      // 插入新文章
      const result = await db
        .insertInto('articles')
        .values({
          rss_source_id: null,  // 关键词文章无 RSS 来源
          title: article.title,
          title_normalized: titleNormalized,
          url: article.url,
          summary: article.abstract || null,
          content: article.abstract || null,
          markdown_content: null,
          filter_status: 'pending',
          filter_score: null,
          filtered_at: null,
          process_status: 'pending',
          process_stages: null,
          processed_at: null,
          published_at: null,
          published_year: article.publishedYear || null,
          published_issue: article.publishedIssue || null,
          published_volume: article.publishedVolume || null,
          error_message: null,
          is_read: 0,
          source_origin: 'keyword',
          journal_id: null,
          keyword_id: keywordId,
          rating: null,
          updated_at: new Date().toISOString()
        })
        .executeTakeFirst();

      savedCount++;
      newCount++;

      const articleId = Number(result.insertId);

      // 触发后续处理（过滤 + 处理流程）
      triggerArticleProcessing(articleId).catch(err => {
        log.warn({ articleId, error: err }, 'Failed to trigger article processing (non-critical)');
      });
    } catch (error) {
      log.error({ error, article: article.title }, 'Failed to save article');
    }
  }

  return { savedCount, newCount };
}

/**
 * 触发文章后续处理
 */
async function triggerArticleProcessing(articleId: number): Promise<void> {
  try {
    // 获取文章信息
    const db = getDb();
    const article = await db
      .selectFrom('articles')
      .where('id', '=', articleId)
      .selectAll()
      .executeTakeFirst();

    if (!article) {
      throw new Error(`Article ${articleId} not found`);
    }

    // 假设关键词文章属于 user_id = 1
    const userId = 1;

    // 执行过滤
    const filterResult = await filterArticle({
      articleId,
      userId,
      title: article.title,
      url: article.url,
      description: article.summary || article.content || ''
    });

    if (!filterResult.passed) {
      log.info({ articleId, reason: filterResult.filterReason }, 'Article filtered out');
      return;
    }

    // 执行处理流程
    await processArticle(articleId, userId);
  } catch (error) {
    log.error({ articleId, error }, 'Article processing failed');
  }
}

/**
 * 更新关键词爬取状态
 */
export async function updateKeywordCrawlStatus(
  keywordId: number,
  articlesCount: number,
  newArticlesCount: number
): Promise<void> {
  const db = getDb();

  // 获取当前值
  const current = await db
    .selectFrom('keyword_subscriptions')
    .where('id', '=', keywordId)
    .select(['crawl_count', 'total_articles'])
    .executeTakeFirst();

  await db
    .updateTable('keyword_subscriptions')
    .set({
      last_crawl_time: new Date().toISOString(),
      crawl_count: (current?.crawl_count || 0) + 1,
      total_articles: (current?.total_articles || 0) + newArticlesCount,
      updated_at: new Date().toISOString()
    })
    .where('id', '=', keywordId)
    .execute();
}

/**
 * 创建爬取日志
 */
export async function createKeywordCrawlLog(params: KeywordCrawlLogParams): Promise<KeywordCrawlLogsSelection> {
  const db = getDb();

  const result = await db
    .insertInto('keyword_crawl_logs')
    .values({
      keyword_id: params.keywordId,
      keyword: params.keyword,
      spider_type: params.spiderType,
      year_start: params.yearStart || null,
      year_end: params.yearEnd || null,
      articles_count: params.articlesCount,
      new_articles_count: params.newArticlesCount,
      status: params.status,
      error_message: params.errorMessage || null,
      duration_ms: params.durationMs || null
    })
    .executeTakeFirstOrThrow();

  return await db
    .selectFrom('keyword_crawl_logs')
    .where('id', '=', Number(result.insertId))
    .selectAll()
    .executeTakeFirstOrThrow();
}

/**
 * 获取爬取日志列表
 */
export async function getKeywordCrawlLogs(
  userId: number,
  keywordId?: number,
  page: number = 1,
  limit: number = 10
): Promise<{ logs: KeywordCrawlLogsSelection[]; total: number; page: number; limit: number; totalPages: number }> {
  const db = getDb();
  const offset = (page - 1) * limit;

  let query = db
    .selectFrom('keyword_crawl_logs')
    .innerJoin('keyword_subscriptions', 'keyword_crawl_logs.keyword_id', 'keyword_subscriptions.id')
    .where('keyword_subscriptions.user_id', '=', userId);

  if (keywordId) {
    query = query.where('keyword_crawl_logs.keyword_id', '=', keywordId);
  }

  // 获取总数
  const countResult = await query
    .select((eb) => [eb.fn.count('keyword_crawl_logs.id').as('total')])
    .executeTakeFirst();

  const total = Number(countResult?.total || 0);
  const totalPages = Math.ceil(total / limit);

  // 获取分页数据
  const logs = await query
    .select([
      'keyword_crawl_logs.id',
      'keyword_crawl_logs.keyword_id',
      'keyword_crawl_logs.keyword',
      'keyword_crawl_logs.spider_type',
      'keyword_crawl_logs.year_start',
      'keyword_crawl_logs.year_end',
      'keyword_crawl_logs.articles_count',
      'keyword_crawl_logs.new_articles_count',
      'keyword_crawl_logs.status',
      'keyword_crawl_logs.error_message',
      'keyword_crawl_logs.duration_ms',
      'keyword_crawl_logs.created_at'
    ])
    .orderBy('keyword_crawl_logs.created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    logs,
    total,
    page,
    limit,
    totalPages
  };
}

/**
 * 关键词信息（用于调度器）
 */
export interface KeywordInfo {
  id: number;
  user_id: number;
  keyword: string;
  year_start: number;
  year_end?: number;
  spider_type: 'google_scholar' | 'cnki';
  num_results: number;
  is_active: number;
  last_crawl_time: string | null;
  crawl_count: number;
  total_articles: number;
  created_at: string;
  updated_at: string;
}
