/**
 * 当日总结服务
 *
 * 负责查询当日通过的文章、按源类型排序、调用 LLM 生成总结、管理历史记录
 */

import { getDb, type DailySummariesSelection } from '../db.js';
import { logger } from '../logger.js';
import { getUserLLMProvider } from '../llm.js';
import { resolveSystemPrompt } from './system-prompts.js';
import { SOURCE_TYPE_PRIORITY, SOURCE_TYPE_LABELS, type SourceType } from '../constants/source-types.js';
import { getUserTimezone, buildUtcRangeFromLocalDate, getUserLocalDate } from './timezone.js';
import { getTelegramNotifier } from '../telegram/index.js';

const log = logger.child({ module: 'daily-summary-service' });

/**
 * 总结类型定义
 * - journal: 期刊类总结
 * - blog_news: 博客资讯类总结
 * - all: 综合总结（历史兼容）
 * - search: 搜索总结（用户手动选择文章生成）
 */
export type SummaryType = 'journal' | 'blog_news' | 'all' | 'search';

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
  date?: string; // YYYY-MM-DD 格式，默认今天
  limit?: number; // 已废弃，使用 type 决定数量
  type?: SummaryType; // 总结类型
}

export interface DailySummaryResult {
  date: string;
  type: SummaryType;
  totalArticles: number;
  articlesByType: {
    journal: DailySummaryArticle[];
    blog: DailySummaryArticle[];
    news: DailySummaryArticle[];
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

/**
 * 获取当日通过的文章，按源类型排序
 * @param type - 总结类型，用于筛选文章来源
 *
 * 数量限制：
 * - journal: 50篇
 * - blog_news: 30篇
 * - all: 60篇（优先40篇期刊，不足或剩余部分由博客/资讯补足）
 */
export async function getDailyPassedArticles(
  userId: number,
  dateStr: string,
  type?: SummaryType
): Promise<DailySummaryArticle[]> {
  const db = getDb();

  // 获取用户时区
  const timezone = await getUserTimezone(userId);

  // 计算日期范围（将本地日期转换为 UTC 时间范围）
  const [startDate, endDate] = buildUtcRangeFromLocalDate(dateStr, timezone);

  log.info({ userId, date: dateStr, timezone, startDate, endDate, type }, 'Daily article query date range');

  // 定义数量限制
  const JOURNAL_LIMIT = 50;
  const BLOG_NEWS_LIMIT = 30;
  const ALL_TOTAL_LIMIT = 60;
  const ALL_JOURNAL_PRIORITY = 40; // all 类型中期刊的优先数量

  // 辅助函数：构建基础查询
  const buildBaseQuery = () => {
    return db
      .selectFrom('articles')
      .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
      .leftJoin('journals', 'journals.id', 'articles.journal_id')
      .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
      .where('articles.filter_status', '=', 'passed')
      .where((eb) => eb.or([
        eb('rss_sources.user_id', '=', userId),
        eb('journals.user_id', '=', userId),
        eb('keyword_subscriptions.user_id', '=', userId),
      ]))
      .where('articles.created_at', '>=', startDate)
      .where('articles.created_at', '<=', endDate);
  };

  // 辅助函数：执行查询并转换结果
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
        eb.fn.coalesce('rss_sources.name', 'journals.name', 'keyword_subscriptions.keyword').as('source_name'),
        eb.fn.coalesce('rss_sources.source_type', eb.val('journal')).as('source_type'),
      ])
      .orderBy('articles.created_at', 'desc')
      .limit(limit)
      .execute();

    return articles.map((row: any) => {
      // 如果是关键词文章，修改 source_name 为 "关键词: xxx"
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
        source_type: row.source_type || 'blog',
        published_at: row.published_at,
      };
    });
  };

  let result: DailySummaryArticle[] = [];

  if (type === 'journal') {
    // 只获取期刊文章（包含关键词爬虫文章），最多50篇
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
    // 只获取博客/资讯文章，最多30篇
    const query = buildBaseQuery()
      .where('articles.source_origin', '=', 'rss')
      .where('rss_sources.source_type', 'in', ['blog', 'news']);
    result = await executeQuery(query, BLOG_NEWS_LIMIT);

  } else {
    // type === 'all' 或 undefined：优先获取40篇期刊（包含关键词），不足或剩余部分由博客/资讯补足
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
      const blogNewsQuery = buildBaseQuery()
        .where('articles.source_origin', '=', 'rss')
        .where('rss_sources.source_type', 'in', ['blog', 'news']);
      blogNewsArticles = await executeQuery(blogNewsQuery, remainingCount);
    }

    result = [...journalArticles, ...blogNewsArticles];
  }

  // 按源类型优先级排序（保持一致性）
  result.sort((a, b) => {
    const priorityA = SOURCE_TYPE_PRIORITY[a.source_type] ?? 999;
    const priorityB = SOURCE_TYPE_PRIORITY[b.source_type] ?? 999;
    return priorityA - priorityB;
  });

  log.info({ userId, date: dateStr, count: result.length, type }, 'Fetched daily articles for summary');

  return result;
}

/**
 * 构建文章列表文本（用于 LLM 输入）
 */
function buildArticlesListText(articlesByType: {
  journal: DailySummaryArticle[];
  blog: DailySummaryArticle[];
  news: DailySummaryArticle[];
}): string {
  let text = '';

  const addSection = (title: string, articles: DailySummaryArticle[]) => {
    if (articles.length === 0) return;
    text += `\n## ${title}\n`;
    articles.forEach((article, index) => {
      const content = article.markdown_content || article.summary || '';
      const preview = content.length > 300 ? content.substring(0, 300) + '...' : content;
      text += `${index + 1}. **${article.title}**\n`;
      text += `   来源：${article.source_name}\n`;
      text += `   预览：${preview}\n\n`;
    });
  };

  addSection('期刊精选', articlesByType.journal);
  addSection('博客推荐', articlesByType.blog);
  addSection('资讯动态', articlesByType.news);

  return text;
}

/**
 * 生成当日总结
 */
export async function generateDailySummary(
  input: DailySummaryInput
): Promise<DailySummaryResult> {
  const { userId, date, type = 'all' } = input;

  // 默认使用今天日期（用户时区）
  const today = date || await getUserLocalDate(userId);

  // 获取文章列表（根据类型自动决定数量）
  const articles = await getDailyPassedArticles(userId, today, type);

  if (articles.length === 0) {
    return {
      date: today,
      type,
      totalArticles: 0,
      articlesByType: { journal: [], blog: [], news: [] },
      summary: '当日暂无通过的文章。',
      generatedAt: new Date().toISOString(),
    };
  }

  // 按类型分组
  const articlesByType = {
    journal: articles.filter(a => a.source_type === 'journal'),
    blog: articles.filter(a => a.source_type === 'blog'),
    news: articles.filter(a => a.source_type === 'news'),
  };

  // 构建文章列表文本
  const articlesText = buildArticlesListText(articlesByType);

  // 根据总结类型定制提示词
  const typePrompt = type === 'journal' 
    ? '这是一份期刊类文章总结，请重点关注学术研究和专业领域的内容。'
    : type === 'blog_news'
    ? '这是一份博客和资讯类文章总结，请重点关注技术动态和行业资讯。'
    : '请综合分析期刊、博客和资讯的内容。';

  // 获取系统提示词并渲染
  const promptTemplate = await resolveSystemPrompt(
    userId,
    'daily_summary',
    `你是专业的内容总结助手。请根据以下文章列表生成当日总结。

## 文章列表
${articlesText}

## 输出要求
1. 生成 800-1000 字的中文总结
2. 按主题领域归纳文章内容
3. ${typePrompt}
4. 使用清晰的层次结构（Markdown 格式）`,
    {
      ARTICLES_LIST: articlesText,
      DATE_RANGE: today,
    }
  );

  // 调用 LLM 生成总结
  const llm = await getUserLLMProvider(userId, 'daily_summary');
  const summary = await llm.chat(
    [
      { role: 'system', content: promptTemplate },
      { role: 'user', content: `请生成 ${today} 的当日总结。` },
    ],
    {
      temperature: 0.3,
      label: 'daily_summary',
    }
  );

  log.info({ userId, date: today, articleCount: articles.length, type }, 'Daily summary generated');

  // 推送到 Telegram（异步，不阻塞主流程）
  const result = {
    date: today,
    type,
    totalArticles: articles.length,
    articlesByType,
    summary,
    generatedAt: new Date().toISOString(),
  };

  getTelegramNotifier().sendDailySummary(userId, {
    date: result.date,
    type: result.type,
    totalArticles: result.totalArticles,
    summary: result.summary,
    articlesByType: {
      journal: result.articlesByType.journal.length,
      blog: result.articlesByType.blog.length,
      news: result.articlesByType.news.length,
    },
  }).catch(err => {
    log.warn({ error: err }, 'Failed to send daily summary to Telegram');
  });

  return result;
}

/**
 * 保存总结到数据库
 */
export async function saveDailySummary(input: SaveDailySummaryInput): Promise<void> {
  const db = getDb();
  const { userId, date, type, articleCount, summaryContent, articlesData } = input;

  // 将 articlesData 转换为 JSON 字符串
  const articlesJson = JSON.stringify(articlesData);

  // 使用 INSERT OR REPLACE 处理重复（同一天同一用户同一类型）
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
 * 获取指定日期的总结
 * @param type - 可选，指定总结类型
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
 * 获取历史总结列表
 * @param type - 可选，筛选指定类型
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
 * 获取今日总结（如果存在）
 * @param type - 可选，指定总结类型
 */
export async function getTodaySummary(
  userId: number,
  type?: SummaryType
): Promise<DailySummariesSelection | undefined> {
  const today = await getUserLocalDate(userId);
  return getDailySummaryByDate(userId, today, type);
}

/**
 * 根据文章 ID 列表生成搜索总结
 * @param userId - 用户 ID
 * @param articleIds - 文章 ID 列表
 */
export async function generateSearchSummary(
  userId: number,
  articleIds: number[]
): Promise<DailySummaryResult> {
  const db = getDb();

  // 查询文章
  const articles = await db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .where('articles.id', 'in', articleIds)
    .where((eb) => eb.or([
      eb('rss_sources.user_id', '=', userId),
      eb('journals.user_id', '=', userId),
      eb('keyword_subscriptions.user_id', '=', userId),
    ]))
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
    .execute();

  if (articles.length === 0) {
    const today = await getUserLocalDate(userId);
    return {
      date: today,
      type: 'search',
      totalArticles: 0,
      articlesByType: { journal: [], blog: [], news: [] },
      summary: '未找到选中的文章。',
      generatedAt: new Date().toISOString(),
    };
  }

  // 转换为 DailySummaryArticle 格式
  const summaryArticles: DailySummaryArticle[] = articles.map((row: any) => {
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
      source_type: row.source_type || 'blog',
      published_at: row.published_at,
    };
  });

  // 按类型分组
  const articlesByType = {
    journal: summaryArticles.filter(a => a.source_type === 'journal'),
    blog: summaryArticles.filter(a => a.source_type === 'blog'),
    news: summaryArticles.filter(a => a.source_type === 'news'),
  };

  // 构建文章列表文本
  const articlesText = buildArticlesListText(articlesByType);

  // 获取系统提示词并渲染
  const today = await getUserLocalDate(userId);
  const promptTemplate = await resolveSystemPrompt(
    userId,
    'daily_summary',
    `你是专业的内容总结助手。请根据以下文章列表生成总结。

## 文章列表
${articlesText}

## 输出要求
1. 生成 500-800 字的中文总结
2. 按主题领域归纳文章内容
3. 使用清晰的层次结构（Markdown 格式）`,
    {
      ARTICLES_LIST: articlesText,
      DATE_RANGE: today,
    }
  );

  // 调用 LLM 生成总结
  const llm = await getUserLLMProvider(userId, 'daily_summary');
  const summary = await llm.chat(
    [
      { role: 'system', content: promptTemplate },
      { role: 'user', content: '请生成这些文章的总结。' },
    ],
    {
      temperature: 0.3,
      label: 'search_summary',
    }
  );

  log.info({ userId, articleCount: articles.length }, 'Search summary generated');

  // 保存到数据库（使用当前日期作为 summary_date）
  await saveDailySummary({
    userId,
    date: today,
    type: 'search',
    articleCount: articles.length,
    summaryContent: summary,
    articlesData: articlesByType,
  });

  return {
    date: today,
    type: 'search',
    totalArticles: articles.length,
    articlesByType,
    summary,
    generatedAt: new Date().toISOString(),
  };
}
