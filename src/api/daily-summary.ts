/**
 * 当日总结服务
 *
 * 负责查询当日通过的文章、按源类型排序、调用 LLM 生成总结、管理历史记录
 */

import { getDb, type DailySummariesTable } from '../db.js';
import { logger } from '../logger.js';
import { getUserLLMProvider } from '../llm.js';
import { resolveSystemPrompt } from './system-prompts.js';

const log = logger.child({ module: 'daily-summary-service' });

// 源类型优先级映射
const SOURCE_TYPE_PRIORITY: Record<string, number> = {
  journal: 1,
  blog: 2,
  news: 3,
};

// 源类型中文标签
const SOURCE_TYPE_LABELS: Record<string, string> = {
  journal: '期刊',
  blog: '博客',
  news: '资讯',
};

export interface DailySummaryArticle {
  id: number;
  title: string;
  url: string;
  summary: string | null;
  markdown_content: string | null;
  source_name: string;
  source_type: 'journal' | 'blog' | 'news';
  published_at: string | null;
}

export interface DailySummaryInput {
  userId: number;
  date?: string; // YYYY-MM-DD 格式，默认今天
  limit?: number; // 默认 30
}

export interface DailySummaryResult {
  date: string;
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
  article_count: number;
  summary_content: string;
  created_at: string;
}

export interface SaveDailySummaryInput {
  userId: number;
  date: string;
  articleCount: number;
  summaryContent: string;
  articlesData: DailySummaryResult['articlesByType'];
}

/**
 * 获取当日通过的文章，按源类型排序
 */
export async function getDailyPassedArticles(
  userId: number,
  dateStr: string,
  limit: number = 30
): Promise<DailySummaryArticle[]> {
  const db = getDb();

  // 计算日期范围（当天 00:00:00 到 23:59:59）
  const startDate = new Date(dateStr + 'T00:00:00.000Z').toISOString();
  const endDate = new Date(dateStr + 'T23:59:59.999Z').toISOString();

  const articles = await db
    .selectFrom('articles')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .where('articles.filter_status', '=', 'passed')
    .where('articles.created_at', '>=', startDate)
    .where('articles.created_at', '<=', endDate)
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
  const { userId, date, limit = 30 } = input;

  // 默认使用今天日期（用户时区）
  const today = date || new Date().toISOString().split('T')[0];

  // 获取文章列表
  const articles = await getDailyPassedArticles(userId, today, limit);

  if (articles.length === 0) {
    return {
      date: today,
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
3. 突出期刊、博客、资讯的核心观点
4. 使用清晰的层次结构（Markdown 格式）`,
    {
      ARTICLES_LIST: articlesText,
      DATE_RANGE: today,
    }
  );

  // 调用 LLM 生成总结
  const llm = await getUserLLMProvider(userId);
  const summary = await llm.chat(
    [
      { role: 'system', content: promptTemplate },
      { role: 'user', content: `请生成 ${today} 的当日总结。` },
    ],
    {
      temperature: 0.3,
      maxTokens: 2048,
      label: 'daily_summary',
    }
  );

  log.info({ userId, date: today, articleCount: articles.length }, 'Daily summary generated');

  return {
    date: today,
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
  const { userId, date, articleCount, summaryContent, articlesData } = input;

  // 将 articlesData 转换为 JSON 字符串
  const articlesJson = JSON.stringify(articlesData);

  // 使用 INSERT OR REPLACE 处理重复（同一天同一用户）
  await db
    .insertInto('daily_summaries')
    .values({
      user_id: userId,
      summary_date: date,
      article_count: articleCount,
      summary_content: summaryContent,
      articles_data: articlesJson,
      created_at: new Date().toISOString(),
    } as any)
    .onConflict((oc) =>
      oc.columns(['user_id', 'summary_date']).doUpdateSet({
        article_count: articleCount,
        summary_content: summaryContent,
        articles_data: articlesJson,
        created_at: new Date().toISOString(),
      })
    )
    .execute();

  log.info({ userId, date, articleCount }, 'Daily summary saved');
}

/**
 * 获取指定日期的总结
 */
export async function getDailySummaryByDate(
  userId: number,
  date: string
): Promise<DailySummariesTable | undefined> {
  const db = getDb();
  return db
    .selectFrom('daily_summaries')
    .where('user_id', '=', userId)
    .where('summary_date', '=', date)
    .selectAll()
    .executeTakeFirst();
}

/**
 * 获取历史总结列表
 */
export async function getDailySummaryHistory(
  userId: number,
  limit: number = 30
): Promise<DailySummaryHistoryItem[]> {
  const db = getDb();
  const results = await db
    .selectFrom('daily_summaries')
    .where('user_id', '=', userId)
    .selectAll()
    .orderBy('summary_date', 'desc')
    .limit(limit)
    .execute();

  return results.map((row) => ({
    id: row.id,
    summary_date: row.summary_date,
    article_count: row.article_count,
    summary_content: row.summary_content,
    created_at: row.created_at,
  }));
}

/**
 * 获取今日总结（如果存在）
 */
export async function getTodaySummary(
  userId: number
): Promise<DailySummariesTable | undefined> {
  const today = new Date().toISOString().split('T')[0];
  return getDailySummaryByDate(userId, today);
}
