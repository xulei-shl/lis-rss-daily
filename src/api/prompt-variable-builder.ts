/**
 * Prompt Variable Builder
 *
 * 统一的系统提示词变量构建器。
 * 根据提示词类型和上下文自动从数据库获取变量值。
 *
 * 新增变量或修改变量逻辑时，只需修改此文件。
 */

import { getDb } from '../db.js';
import { getActiveTopicDomains } from './topic-domains.js';
import { getActiveKeywordsForDomain } from './topic-keywords.js';
import { SOURCE_TYPE_PRIORITY, SOURCE_TYPE_LABELS, type SourceType } from '../constants/source-types.js';

/* ── Types ── */

/**
 * 文章上下文 - 用于构建文章相关的变量
 */
export interface ArticleContext {
  articleId: number;
  userId: number;
  title: string;
  url?: string;
  description: string;
  content?: string;
  sourceType?: SourceType;
  sourceName?: string;
  author?: string;
  publishedAt?: string;
}

/**
 * 多篇文章上下文 - 用于 daily_summary 等
 */
export interface ArticlesContext {
  userId: number;
  date?: string;
}

/**
 * 变量构建上下文 - 联合类型，根据 type 不同使用不同字段
 */
export interface VariableBuildContext {
  type: string;
  userId?: number;
  article?: ArticleContext;
  articles?: ArticlesContext;
  [key: string]: unknown;
}

/**
 * 构建结果
 */
export interface BuildVariablesResult {
  variables: Record<string, string>;
  error?: string;
}

/* ── Helper Functions ── */

/**
 * 构建领域信息文本（用于 filter 类型）
 */
async function buildDomainsInfo(userId: number): Promise<string> {
  const activeDomains = await getActiveTopicDomains(userId);
  if (activeDomains.length === 0) {
    return '暂无配置主题领域';
  }

  const domainsInfo = await Promise.all(
    activeDomains.map(async (domain) => {
      const keywords = await getActiveKeywordsForDomain(domain.id);
      return {
        id: domain.id,
        name: domain.name,
        description: domain.description || '',
        keywords: keywords.map((k) => ({
          keyword: k.keyword,
          description: k.description || '',
          weight: k.weight,
        })),
      };
    })
  );

  return domainsInfo
    .map((d) => `
## 领域ID: ${d.id} - ${d.name}
描述: ${d.description}
主题词:
${d.keywords.length > 0 ? d.keywords
  .map((k) => {
    const descPart = k.description ? `，描述/同义词：${k.description}` : '';
    return `- ${k.keyword}（权重：${k.weight}${descPart}）`;
  })
  .join('\n') : '- 无'}
`)
    .join('\n');
}

/**
 * 从数据库获取文章的详细信息（用于预留变量）
 */
async function fetchArticleDetails(articleId: number): Promise<{
  sourceType: SourceType;
  sourceName: string;
  author: string;
  publishedAt: string | null;
}> {
  const db = getDb();
  const result = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('articles.id', '=', articleId)
    .select(['rss_sources.source_type', 'rss_sources.name', 'articles.published_at'])
    .executeTakeFirst();

  return {
    sourceType: result?.source_type ?? 'blog',
    sourceName: result?.name ?? '',
    author: '', // articles 表暂无 author 字段，返回空字符串
    publishedAt: result?.published_at ?? null,
  };
}

/**
 * 获取指定日期的文章列表（用于 daily_summary）
 */
async function fetchArticlesForSummary(
  userId: number,
  date: string
): Promise<Array<{
  id: number;
  title: string;
  url: string;
  summary: string | null;
  source_type: SourceType;
  domain_name: string | null;
}>> {
  const db = getDb();
  const articles = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('article_filter_logs', 'article_filter_logs.article_id', 'articles.id')
    .leftJoin('topic_domains', 'topic_domains.id', 'article_filter_logs.domain_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.created_at', '>=', `${date}T00:00:00.000Z`)
    .where('articles.created_at', '<', `${date}T23:59:59.999Z`)
    .select([
      'articles.id',
      'articles.title',
      'articles.url',
      'articles.summary',
      'rss_sources.source_type',
      'topic_domains.name as domain_name',
    ])
    .execute();

  return articles.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    summary: row.summary,
    source_type: row.source_type || 'blog',
    domain_name: row.domain_name,
  }));
}

/* ── Type-specific Builders ── */

/**
 * filter 类型变量构建器
 */
async function buildFilterVariables(context: VariableBuildContext): Promise<BuildVariablesResult> {
  const { article } = context;

  if (!article) {
    return { variables: {}, error: 'filter 类型需要 article 上下文' };
  }

  // 从数据库获取文章详情（如果未提供）
  const details = await fetchArticleDetails(article.articleId);
  const sourceType = article.sourceType ?? details.sourceType;
  const sourceName = article.sourceName ?? details.sourceName;
  const author = article.author ?? details.author;
  const publishedAt = article.publishedAt ?? details.publishedAt;

  const variables: Record<string, string> = {
    TOPIC_DOMAINS: await buildDomainsInfo(article.userId),
    ARTICLE_TITLE: article.title || '无',
    ARTICLE_URL: article.url || '无',
    ARTICLE_CONTENT: article.content ? article.content.substring(0, 2000) : '',
    SOURCE_TYPE: SOURCE_TYPE_LABELS[sourceType],
    ARTICLE_SOURCE: sourceName || '未知来源',
    ARTICLE_AUTHOR: author || '未知作者',
    PUBLISHED_DATE: publishedAt ? new Date(publishedAt).toLocaleDateString('zh-CN') : '未知日期',
  };

  return { variables };
}

/**
 * summary 类型变量构建器
 */
async function buildSummaryVariables(context: VariableBuildContext): Promise<BuildVariablesResult> {
  const { article } = context;

  if (!article) {
    return { variables: {}, error: 'summary 类型需要 article 上下文' };
  }

  const variables: Record<string, string> = {
    ARTICLE_TITLE: article.title || '无',
    ARTICLE_CONTENT: article.content ? article.content.substring(0, 3000) : article.description || '',
  };

  return { variables };
}

/**
 * keywords 类型变量构建器
 */
async function buildKeywordsVariables(context: VariableBuildContext): Promise<BuildVariablesResult> {
  const { article } = context;

  if (!article) {
    return { variables: {}, error: 'keywords 类型需要 article 上下文' };
  }

  const variables: Record<string, string> = {
    ARTICLE_TITLE: article.title || '无',
    ARTICLE_CONTENT: article.content ? article.content.substring(0, 1200) : '',
    ARTICLE_URL: article.url || '无',
  };

  return { variables };
}

/**
 * translation 类型变量构建器
 */
async function buildTranslationVariables(context: VariableBuildContext): Promise<BuildVariablesResult> {
  const { article } = context;

  if (!article) {
    return { variables: {}, error: 'translation 类型需要 article 上下文' };
  }

  const variables: Record<string, string> = {
    ARTICLE_TITLE: article.title || '无',
    ARTICLE_CONTENT: article.content || '无',
  };

  return { variables };
}

/**
 * daily_summary 类型变量构建器
 */
async function buildDailySummaryVariables(context: VariableBuildContext): Promise<BuildVariablesResult> {
  const { articles, userId } = context;

  if (!articles || !userId) {
    return { variables: {}, error: 'daily_summary 类型需要 articles 和 userId 上下文' };
  }

  const date = articles.date || new Date().toISOString().split('T')[0];
  const fetchedArticles = await fetchArticlesForSummary(userId, date);

  // 按源类型分组
  const sortedArticles = [...fetchedArticles].sort((a, b) => {
    const priorityA = SOURCE_TYPE_PRIORITY[a.source_type] ?? 999;
    const priorityB = SOURCE_TYPE_PRIORITY[b.source_type] ?? 999;
    return priorityA - priorityB;
  });

  // 构建文章列表文本
  const articlesText = sortedArticles
    .map((a) => {
      const sourceLabel = SOURCE_TYPE_LABELS[a.source_type];
      const domainLabel = a.domain_name ? ` [${a.domain_name}]` : '';
      return `- [${sourceLabel}]${domainLabel} ${a.title}\n  ${a.summary || a.url}`;
    })
    .join('\n\n');

  const variables: Record<string, string> = {
    ARTICLES_LIST: articlesText || '暂无文章',
    DATE_RANGE: date,
    SUMMARY_LENGTH: '800-1000',
  };

  return { variables };
}

/**
 * analysis 类型变量构建器（预留）
 */
async function buildAnalysisVariables(context: VariableBuildContext): Promise<BuildVariablesResult> {
  const { article } = context;

  if (!article) {
    return { variables: {}, error: 'analysis 类型需要 article 上下文' };
  }

  // 从数据库获取文章详情
  const details = await fetchArticleDetails(article.articleId);
  const sourceName = article.sourceName ?? details.sourceName;
  const author = article.author ?? details.author;
  const publishedAt = article.publishedAt ?? details.publishedAt;

  const variables: Record<string, string> = {
    ARTICLE_TITLE: article.title || '无',
    ARTICLE_SOURCE: sourceName || '未知来源',
    ARTICLE_AUTHOR: author || '未知作者',
    PUBLISHED_DATE: publishedAt ? new Date(publishedAt).toLocaleDateString('zh-CN') : '未知日期',
    ARTICLE_CONTENT: article.content || '无内容',
  };

  return { variables };
}

/* ── Main Builder Function ── */

/**
 * 根据提示词类型构建变量
 * @param context - 构建上下文，包含 type 和必要的业务数据
 * @returns 变量对象
 */
export async function buildPromptVariables(
  context: VariableBuildContext
): Promise<Record<string, string>> {
  const { type } = context;

  let result: BuildVariablesResult;

  switch (type) {
    case 'filter':
      result = await buildFilterVariables(context);
      break;
    case 'summary':
      result = await buildSummaryVariables(context);
      break;
    case 'keywords':
      result = await buildKeywordsVariables(context);
      break;
    case 'translation':
      result = await buildTranslationVariables(context);
      break;
    case 'daily_summary':
      result = await buildDailySummaryVariables(context);
      break;
    case 'analysis':
      result = await buildAnalysisVariables(context);
      break;
    default:
      result = { variables: {}, error: `未知的提示词类型: ${type}` };
  }

  if (result.error) {
    console.warn(`[prompt-variable-builder] ${result.error}`);
  }

  return result.variables;
}

/**
 * 便捷函数：为 filter 类型构建变量
 */
export async function buildFilterVariablesFromArticle(
  article: ArticleContext
): Promise<Record<string, string>> {
  return buildPromptVariables({ type: 'filter', article });
}

/**
 * 便捷函数：为 summary 类型构建变量
 */
export async function buildSummaryVariablesFromArticle(
  article: ArticleContext
): Promise<Record<string, string>> {
  return buildPromptVariables({ type: 'summary', article });
}
