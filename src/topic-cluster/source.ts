/**
 * 输入数据源（**只读**）。
 *
 * 本文件是本模块唯一读取 articles 表的地方，与 repo/ 严格区分：
 *   - source.ts  读「别人的表」（articles），只读、不写；
 *   - repo/*.ts  读写「自己的表」（cluster_* / topic_*）。
 *
 * 聚类范围只包含**有全文总结（ai_summary 非空）的文章**（设计文档 §2.1）。
 */

import { sql } from 'kysely';
import { getDb } from '../db.js';
import { CLUSTER_CONFIG, CLUSTER_LIMITS } from './config.js';

export interface FacetSourceArticle {
  articleId: number;
  title: string;
  aiSummary: string;
  publishedAt: string | null;
  publishedYear: number | null;
  createdAt: string | null;
}

export interface ArticleBrief {
  articleId: number;
  title: string;
  url: string | null;
  publishedAt: string | null;
  publishedYear: number | null;
  createdAt: string | null;
}

export interface ListSourceOptions {
  /** 只取 id 大于此值（增量） */
  minArticleId?: number;
  limit?: number;
  /** 仅处理指定文章（小样本抽检用） */
  articleIds?: number[];
}

/**
 * 基础查询：文章 + 各来源表连接 + 用户归属过滤 + 范围过滤。
 *
 * 用户归属口径与每日总结/洞察报告一致（articles 表本身没有 user_id，
 * 归属经由各来源表的 user_id 判定）。
 */
function baseQuery(userId: number) {
  let query = getDb()
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .leftJoin('email_sources', 'email_sources.id', 'articles.email_source_id')
    .leftJoin('web_sources', 'web_sources.id', 'articles.web_source_id')
    .where((eb) =>
      eb.or([
        eb('rss_sources.user_id', '=', userId),
        eb('journals.user_id', '=', userId),
        eb('keyword_subscriptions.user_id', '=', userId),
        eb('email_sources.user_id', '=', userId),
        eb('web_sources.user_id', '=', userId),
      ])
    );

  if (CLUSTER_CONFIG.scope === 'journal_only') {
    query = query.where('articles.journal_id', 'is not', null);
  }

  return query;
}

function toSourceArticle(row: {
  article_id: number;
  title: string | null;
  ai_summary: string | null;
  published_at: string | null;
  published_year: number | null;
  created_at: string | null;
}): FacetSourceArticle | null {
  if (typeof row.ai_summary !== 'string' || row.ai_summary.trim().length === 0) return null;
  return {
    articleId: Number(row.article_id),
    title: row.title ?? '',
    aiSummary: row.ai_summary,
    publishedAt: row.published_at ?? null,
    publishedYear: row.published_year ?? null,
    createdAt: row.created_at ?? null,
  };
}

/**
 * 待抽取切面的文章（已有全文总结、且尚未有合格切面）。
 *
 * ⚠️ 「已抽过」的过滤**必须在 SQL 层完成**，不能只靠调用方事后跳过：
 * 若在应用层跳过，`limit` 会反复命中同一批文章，导致抽取永远停滞在第 N 篇
 * （冷启动抽不完、每日流水线的切面步骤也永远不前进）。
 *
 * 「合格」的判定标准是 `facet_contract_version` 与当前配置一致——
 * 契约版本变化时，历史切面会被自动视为待重抽。
 */
export async function listFacetSourceArticles(
  userId: number,
  options: ListSourceOptions = {}
): Promise<FacetSourceArticle[]> {
  let query = baseQuery(userId)
    // 反向连接：只保留在切面表里「匹配不上」的文章
    .leftJoin('article_cluster_facets as acf', (join) =>
      join
        .onRef('acf.article_id', '=', 'articles.id')
        .on('acf.facet_contract_version', '=', CLUSTER_CONFIG.facetContractVersion)
    )
    .select([
      'articles.id as article_id',
      'articles.title as title',
      'articles.ai_summary as ai_summary',
      'articles.published_at as published_at',
      'articles.published_year as published_year',
      'articles.created_at as created_at',
    ])
    .where('articles.ai_summary', 'is not', null)
    .where('articles.ai_summary', '!=', '')
    // 过短的「全文总结」是测试/异常残留（如 26 字符占位），抽不出有意义的切面，
    // 只会白花 token 并污染聚类。过滤必须在 SQL 层，否则它们会反复占用 limit 窗口。
    .where(sql<boolean>`length(articles.ai_summary) >= ${CLUSTER_LIMITS.minFacetSummaryChars}`)
    .where('acf.article_id', 'is', null);

  if (options.minArticleId) {
    query = query.where('articles.id', '>', options.minArticleId);
  }
  if (options.articleIds && options.articleIds.length > 0) {
    query = query.where('articles.id', 'in', options.articleIds);
  }

  // 新→旧：每日增量优先处理刚进来的文章；冷启动首批也能落到有代表性的样本上，
  // 而不是从头撞上最早期的测试残留。
  const rows = await query
    .orderBy('articles.created_at', 'desc')
    .orderBy('articles.id', 'desc')
    .limit(options.limit ?? 500)
    .execute();

  return rows
    .map((row) => toSourceArticle(row))
    .filter((item): item is FacetSourceArticle => item !== null);
}

/** 待抽取切面的文章总数（用于进度显示与分批规划） */
export async function countFacetSourceArticles(
  userId: number,
  options: Pick<ListSourceOptions, 'minArticleId'> = {}
): Promise<number> {
  let query = baseQuery(userId)
    .leftJoin('article_cluster_facets as acf', (join) =>
      join
        .onRef('acf.article_id', '=', 'articles.id')
        .on('acf.facet_contract_version', '=', CLUSTER_CONFIG.facetContractVersion)
    )
    .where('articles.ai_summary', 'is not', null)
    .where('articles.ai_summary', '!=', '')
    .where(sql<boolean>`length(articles.ai_summary) >= ${CLUSTER_LIMITS.minFacetSummaryChars}`)
    .where('acf.article_id', 'is', null)
    .select((eb) => eb.fn.count('articles.id').as('count'));

  if (options.minArticleId) {
    query = query.where('articles.id', '>', options.minArticleId);
  }

  const row = await query.executeTakeFirst();
  return Number(row?.count ?? 0);
}

/** 指定文章的切面原料（重算单篇时使用） */
export async function getFacetSourceArticle(
  userId: number,
  articleId: number
): Promise<FacetSourceArticle | null> {
  const row = await baseQuery(userId)
    .select([
      'articles.id as article_id',
      'articles.title as title',
      'articles.ai_summary as ai_summary',
      'articles.published_at as published_at',
      'articles.published_year as published_year',
      'articles.created_at as created_at',
    ])
    .where('articles.id', '=', articleId)
    .executeTakeFirst();

  return row ? toSourceArticle(row) : null;
}

/** 文章摘要信息（前端展示与趋势叙述用） */
export async function getArticleBriefs(articleIds: number[]): Promise<Map<number, ArticleBrief>> {
  const map = new Map<number, ArticleBrief>();
  if (articleIds.length === 0) return map;

  const rows = await getDb()
    .selectFrom('articles')
    .select([
      'id as article_id',
      'title as title',
      'url as url',
      'published_at as published_at',
      'published_year as published_year',
      'created_at as created_at',
    ])
    .where('id', 'in', articleIds)
    .execute();

  for (const row of rows) {
    const articleId = Number(row.article_id);
    map.set(articleId, {
      articleId,
      title: row.title ?? '',
      url: row.url ?? null,
      publishedAt: row.published_at ?? null,
      publishedYear: row.published_year ?? null,
      createdAt: row.created_at ?? null,
    });
  }
  return map;
}
