/**
 * 当日总结服务
 *
 * 负责查询当日通过的文章、按源类型排序、调用 LLM 生成总结、管理历史记录
 */

import { getDb, type DailySummariesTable } from '../db.js';
import { logger } from '../logger.js';
import { getUserLLMProvider } from '../llm.js';
import { resolveSystemPrompt } from './system-prompts.js';
import { SOURCE_TYPE_PRIORITY, SOURCE_TYPE_LABELS, type SourceType } from '../constants/source-types.js';
import { config } from '../config.js';
import { getUserSetting } from './settings.js';

const log = logger.child({ module: 'daily-summary-service' });

/**
 * 总结类型定义
 * - journal: 期刊类总结
 * - blog_news: 博客资讯类总结
 * - all: 综合总结（历史兼容）
 */
export type SummaryType = 'journal' | 'blog_news' | 'all';

/**
 * 获取用户时区设置
 */
async function getUserTimezone(userId: number): Promise<string> {
  const setting = await getUserSetting(userId, 'timezone');
  return setting || config.defaultTimezone;
}

/**
 * 将本地日期转换为 UTC 查询范围
 *
 * @param dateStr - 本地日期字符串 (YYYY-MM-DD)
 * @param timezone - 时区 (如 'Asia/Shanghai')
 * @returns [startUtc, endUtc] UTC 时间范围
 *
 * @example
 * // 本地日期 2026-02-15 (Asia/Shanghai UTC+8)
 * // 本地 2026-02-15 00:00:00 = UTC 2026-02-14 16:00:00
 * // 本地 2026-02-15 23:59:59 = UTC 2026-02-15 15:59:59
 */
function localDateToUtcRange(dateStr: string, timezone: string): [string, string] {
  // 构造本地日期的开始和结束时间
  const localStart = new Date(`${dateStr}T00:00:00`);
  const localEnd = new Date(`${dateStr}T23:59:59.999`);

  // 转换为 ISO 字符串并保留时区信息
  const startIso = localStart.toLocaleString('en-US', { timeZone: timezone, hour12: false });
  const endIso = localEnd.toLocaleString('en-US', { timeZone: timezone, hour12: false });

  // 重新构造带时区的 Date 对象并转换为 UTC
  const startUtc = new Date(
    new Date(`${dateStr}T00:00:00`).toLocaleString('en-US', { timeZone: 'UTC' })
  );
  const endUtc = new Date(
    new Date(`${dateStr}T23:59:59.999`).toLocaleString('en-US', { timeZone: 'UTC' })
  );

  // 更精确的方法：直接计算时区偏移
  const offsetMs = getTimezoneOffsetMs(timezone);
  const startDate = new Date(`${dateStr}T00:00:00.000Z`);
  const endDate = new Date(`${dateStr}T23:59:59.999Z`);

  // 应用时区偏移（本地时间 -> UTC）
  // 本地时间 = UTC + offset，所以 UTC = 本地时间 - offset
  const startUtcTime = new Date(startDate.getTime() - offsetMs);
  const endUtcTime = new Date(endDate.getTime() - offsetMs);

  return [startUtcTime.toISOString(), endUtcTime.toISOString()];
}

/**
 * 获取时区偏移毫秒数
 */
function getTimezoneOffsetMs(timezone: string): number {
  // 创建一个日期对象来获取时区偏移
  const date = new Date();
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  return tzDate.getTime() - utcDate.getTime();
}

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
  limit?: number; // 默认 30
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
 */
export async function getDailyPassedArticles(
  userId: number,
  dateStr: string,
  limit: number = 30,
  type?: SummaryType
): Promise<DailySummaryArticle[]> {
  const db = getDb();

  // 获取用户时区
  const timezone = await getUserTimezone(userId);

  // 计算日期范围（将本地日期转换为 UTC 时间范围）
  // 例如：本地日期 2026-02-15 (UTC+8) -> UTC 范围 [2026-02-14T16:00:00Z, 2026-02-15T15:59:59Z]
  const [startDate, endDate] = localDateToUtcRange(dateStr, timezone);

  log.info({ userId, date: dateStr, timezone, startDate, endDate, type }, 'Daily article query date range');

  let query = db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.created_at', '>=', startDate)
    .where('articles.created_at', '<=', endDate);

  // 根据总结类型筛选文章来源
  if (type === 'journal') {
    query = query.where('rss_sources.source_type', '=', 'journal');
  } else if (type === 'blog_news') {
    query = query.where('rss_sources.source_type', 'in', ['blog', 'news']);
  }
  // type 为 undefined 或 'all' 时不筛选

  const articles = await query
    .select([
      'articles.id',
      'articles.title',
      'articles.url',
      'articles.summary',
      'articles.markdown_content',
      'articles.published_at',
      'rss_sources.name as source_name',
      'rss_sources.source_type',
    ])
    .orderBy('articles.created_at', 'desc')
    .limit(limit)
    .execute();

  // 转换为 DailySummaryArticle 类型
  const result: DailySummaryArticle[] = articles.map((row: any) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    summary: row.summary,
    markdown_content: row.markdown_content,
    source_name: row.source_name,
    source_type: row.source_type || 'blog',
    published_at: row.published_at,
  }));

  // 按源类型优先级排序
  result.sort((a, b) => {
    const priorityA = SOURCE_TYPE_PRIORITY[a.source_type] ?? 999;
    const priorityB = SOURCE_TYPE_PRIORITY[b.source_type] ?? 999;
    return priorityA - priorityB;
  });

  log.info({ userId, date: dateStr, count: result.length }, 'Fetched daily articles for summary');

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
  const { userId, date, limit = 30, type = 'all' } = input;

  // 默认使用今天日期（用户时区）
  const today = date || new Date().toISOString().split('T')[0];

  // 获取文章列表（根据类型筛选）
  const articles = await getDailyPassedArticles(userId, today, limit, type);

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

  return {
    date: today,
    type,
    totalArticles: articles.length,
    articlesByType,
    summary,
    generatedAt: new Date().toISOString(),
  };
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
      created_at: new Date().toISOString(),
    } as any)
    .onConflict((oc) =>
      oc.columns(['user_id', 'summary_date', 'summary_type']).doUpdateSet({
        article_count: articleCount,
        summary_content: summaryContent,
        articles_data: articlesJson,
        created_at: new Date().toISOString(),
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
): Promise<DailySummariesTable | undefined> {
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
): Promise<DailySummariesTable | undefined> {
  const today = new Date().toISOString().split('T')[0];
  return getDailySummaryByDate(userId, today, type);
}
