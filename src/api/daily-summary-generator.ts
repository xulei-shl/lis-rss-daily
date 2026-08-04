/**
 * Daily Summary Generator
 *
 * Pure LLM generation functions for daily summaries.
 * No notification/push logic - that belongs in the scheduler/API layer.
 */

import { logger } from '../logger.js';
import { getUserLLMProvider } from '../llm.js';
import { resolveSystemPrompt } from './system-prompts.js';
import { getUserLocalDate } from './timezone.js';
import { truncatePreview } from '../utils/text-cleaner.js';
import {
  getDailyPassedArticles,
  getAllJournalArticles,
  getInsightsArticles,
  saveDailySummary,
  type SummaryType,
  type DailySummaryArticle,
  type DailySummaryInput,
  type DailySummaryResult,
} from './daily-summary-repository.js';

const log = logger.child({ module: 'daily-summary-generator' });

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build articles list text for LLM input
 */
function buildArticlesListText(articlesByType: {
  journal: DailySummaryArticle[];
  blog: DailySummaryArticle[];
  news: DailySummaryArticle[];
  email: DailySummaryArticle[];
}): string {
  let text = '';

  const addSection = (title: string, articles: DailySummaryArticle[]) => {
    if (articles.length === 0) return;
    text += `\n## ${title}\n`;
    articles.forEach((article, index) => {
      const content = article.markdown_content || article.summary || '';
      const preview = truncatePreview(content, 1000);
      text += `${index + 1}. **${article.title}**\n`;
      text += `   来源：${article.source_name}\n`;
      text += `   预览：${preview}\n\n`;
    });
  };

  addSection('期刊精选', articlesByType.journal);
  addSection('博客推荐', articlesByType.blog);
  addSection('资讯动态', articlesByType.news);
  addSection('邮件订阅', articlesByType.email);

  return text;
}

function getPromptTypeForSummaryType(type: SummaryType): string {
  switch (type) {
    case 'insights':
      return 'insights';
    case 'journal':
    case 'journal_all':
      return 'daily_summary_journal';
    case 'blog_news':
      return 'daily_summary_blog_news';
    default:
      // search / all 等历史类型继续使用 daily_summary
      return 'daily_summary';
  }
}

function buildDailySummaryTypeInstruction(type: SummaryType, date: string): string {
  switch (type) {
    case 'journal':
      return `请生成 ${date} 的期刊类文章总结，重点关注学术研究、方法进展与专业领域趋势。`;
    case 'blog_news':
      return `请生成 ${date} 的博客与资讯类总结，重点关注技术动态、产品更新与行业信息。`;
    case 'journal_all':
      return `请生成 ${date} 的全部期刊文章总结，本次输入包含未通过筛选的期刊文章，也需要完整覆盖。`;
    case 'search':
      return '请基于下面选中的文章生成总结。';
    case 'insights':
      return `请生成 ${date} 的研究趋势洞察报告，突出主题聚类、趋势判断与选题建议。`;
    case 'all':
    default:
      return `请生成 ${date} 的综合总结，综合分析期刊、博客与资讯内容。`;
  }
}

function buildSummaryUserMessage(type: SummaryType, date: string, articlesText: string): string {
  return `${buildDailySummaryTypeInstruction(type, date)}\n\n## 文章列表\n${articlesText}`;
}

function buildDailySummaryPromptVariables(
  articlesText: string,
  date: string,
  summaryLength: string
): Record<string, string> {
  return {
    ARTICLES_LIST: articlesText,
    DATE_RANGE: date,
    SUMMARY_LENGTH: summaryLength,
  };
}

async function buildResolvedDailySummaryUserPrompt(
  userId: number,
  type: SummaryType,
  date: string,
  articlesText: string,
  summaryLength: string
): Promise<string> {
  const promptType = getPromptTypeForSummaryType(type);
  return resolveSystemPrompt(
    userId,
    promptType,
    buildSummaryUserMessage(type, date, articlesText),
    buildDailySummaryPromptVariables(articlesText, date, summaryLength)
  );
}

// ============================================================================
// Generation Functions (pure — no push/save logic)
// ============================================================================

/**
 * Generate daily summary (pure generation, no push, no save to DB)
 */
export async function generateDailySummary(
  input: DailySummaryInput
): Promise<DailySummaryResult> {
  const { userId, date, type = 'all' } = input;

  const today = date || await getUserLocalDate(userId);

  const articles = await getDailyPassedArticles(userId, today, type);

  if (articles.length === 0) {
    return {
      date: today,
      type,
      totalArticles: 0,
      articlesByType: { journal: [], blog: [], news: [], email: [] },
      summary: '当日暂无通过的文章。',
      generatedAt: new Date().toISOString(),
    };
  }

  const articlesByType = {
    journal: articles.filter(a => a.source_type === 'journal'),
    blog: articles.filter(a => a.source_type === 'blog'),
    news: articles.filter(a => a.source_type === 'news'),
    email: articles.filter(a => a.source_type === 'email'),
  };

  const articlesText = buildArticlesListText(articlesByType);

  const userPrompt = await buildResolvedDailySummaryUserPrompt(
    userId,
    type,
    today,
    articlesText,
    '800-1000'
  );

  const llm = await getUserLLMProvider(userId, getPromptTypeForSummaryType(type));
  const summary = await llm.chat(
    [
      { role: 'user', content: userPrompt },
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
 * Generate all-journal summary (includes non-passed articles)
 * Pure generation, no push. Save to DB is done by the caller.
 */
export async function generateJournalAllSummary(
  input: Omit<DailySummaryInput, 'type' | 'limit'>
): Promise<DailySummaryResult> {
  const { userId, date } = input;

  const today = date || await getUserLocalDate(userId);

  const articles = await getAllJournalArticles(userId, today);

  if (articles.length === 0) {
    return {
      date: today,
      type: 'journal_all',
      totalArticles: 0,
      articlesByType: { journal: [], blog: [], news: [], email: [] },
      summary: '当日暂无期刊文章。',
      generatedAt: new Date().toISOString(),
    };
  }

  const articlesByType = {
    journal: articles.filter(a => a.source_type === 'journal' || a.source_type === 'blog' || a.source_type === 'news' || a.source_type === 'email'),
    blog: [],
    news: [],
    email: [],
  };

  const articlesText = buildArticlesListText(articlesByType);

  const userPrompt = await buildResolvedDailySummaryUserPrompt(
    userId,
    'journal_all',
    today,
    articlesText,
    '800-1000'
  );

  const llm = await getUserLLMProvider(userId, getPromptTypeForSummaryType('journal_all'));
  const summary = await llm.chat(
    [
      { role: 'user', content: userPrompt },
    ],
    {
      temperature: 0.3,
      label: 'daily_summary',
    }
  );

  log.info({ userId, date: today, articleCount: articles.length, type: 'journal_all' }, 'Journal all summary generated');

  return {
    date: today,
    type: 'journal_all' as SummaryType,
    totalArticles: articles.length,
    articlesByType,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate search summary from user-selected article IDs.
 * Saves to DB immediately since it's a user-triggered action.
 * No push logic — notifications on demand by the API caller.
 */
export async function generateSearchSummary(
  userId: number,
  articleIds: number[]
): Promise<DailySummaryResult> {
  const db = (await import('../db.js')).getDb();

  const articles = await db
    .selectFrom('articles')
    .leftJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .leftJoin('journals', 'journals.id', 'articles.journal_id')
    .leftJoin('keyword_subscriptions', 'keyword_subscriptions.id', 'articles.keyword_id')
    .leftJoin('email_sources', 'email_sources.id', 'articles.email_source_id')
    .leftJoin('web_sources', 'web_sources.id', 'articles.web_source_id')
    .where('articles.id', 'in', articleIds)
    .where((eb) => eb.or([
      eb('rss_sources.user_id', '=', userId),
      eb('journals.user_id', '=', userId),
      eb('keyword_subscriptions.user_id', '=', userId),
      eb('email_sources.user_id', '=', userId),
      eb('web_sources.user_id', '=', userId),
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
    .execute();

  if (articles.length === 0) {
    const today = await getUserLocalDate(userId);
    return {
      date: today,
      type: 'search',
      totalArticles: 0,
      articlesByType: { journal: [], blog: [], news: [], email: [] },
      summary: '未找到选中的文章。',
      generatedAt: new Date().toISOString(),
    };
  }

  const summaryArticles: DailySummaryArticle[] = articles.map((row: any) => {
    let sourceName = row.source_name || '未知来源';
    let sourceType = row.source_type || 'blog';
    if (row.source_origin === 'keyword') {
      sourceName = `关键词: ${row.source_name}`;
    }
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

  const articlesByType = {
    journal: summaryArticles.filter(a => a.source_type === 'journal'),
    blog: summaryArticles.filter(a => a.source_type === 'blog'),
    news: summaryArticles.filter(a => a.source_type === 'news'),
    email: summaryArticles.filter(a => a.source_type === 'email'),
  };

  const articlesText = buildArticlesListText(articlesByType);
  const today = await getUserLocalDate(userId);

  const userPrompt = await buildResolvedDailySummaryUserPrompt(
    userId,
    'search',
    today,
    articlesText,
    '500-800'
  );

  const llm = await getUserLLMProvider(userId, getPromptTypeForSummaryType('search'));
  const summary = await llm.chat(
    [
      { role: 'user', content: userPrompt },
    ],
    {
      temperature: 0.3,
      label: 'search_summary',
    }
  );

  log.info({ userId, articleCount: articles.length }, 'Search summary generated');

  // Save to DB immediately (user-triggered action)
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

/**
 * Generate insights summary report.
 * Pure generation, no push. Save to DB is done by the caller.
 */
export async function generateInsightsSummary(
  input: { userId: number; days?: number }
): Promise<DailySummaryResult> {
  const { userId, days = 15 } = input;

  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - days);
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() - 1);
  const dateStr = `${startDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}`;

  const articles = await getInsightsArticles(userId, days);

  if (articles.length === 0) {
    return {
      date: dateStr,
      type: 'insights',
      totalArticles: 0,
      articlesByType: { journal: [], blog: [], news: [], email: [] },
      summary: '过去15天暂无通过的文章。',
      generatedAt: new Date().toISOString(),
    };
  }

  const articlesByType = {
    journal: articles.filter(a => a.source_type === 'journal'),
    blog: articles.filter(a => a.source_type === 'blog'),
    news: articles.filter(a => a.source_type === 'news'),
    email: articles.filter(a => a.source_type === 'email'),
  };

  const articlesText = buildArticlesListText(articlesByType);

  const userPrompt = await resolveSystemPrompt(
    userId,
    'insights',
    `你是专业的研究趋势洞察助手。请根据以下文章列表生成研究趋势洞察报告。\n\n## 文章列表\n${articlesText}\n\n## 日期范围：${dateStr}\n\n## 总结指南：\n1. 将同一类主题的文章放在一起分组总结\n2. 每组给出：一段总结 + 选题建议 + 文章列表（ID+标题）\n3. 突出研究趋势和潜在的研究选题方向\n\n## 输出要求：\n1. 生成 1500-3000 字的中文洞察报告\n2. 使用清晰的层次结构（Markdown 格式）`,
    {
      ARTICLES_LIST: articlesText,
      DATE_RANGE: dateStr,
    }
  );

  const llm = await getUserLLMProvider(userId, 'insights');
  const summary = await llm.chat(
    [
      { role: 'user', content: userPrompt },
    ],
    {
      temperature: 0.3,
      label: 'insights_summary',
    }
  );

  log.info({ userId, dateStr, articleCount: articles.length }, 'Insights summary generated');

  return {
    date: dateStr,
    type: 'insights' as SummaryType,
    totalArticles: articles.length,
    articlesByType,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Public Helpers (re-exported for use by formatters)
// ============================================================================

export { buildArticlesListText, buildDailySummaryTypeInstruction, buildSummaryUserMessage, buildDailySummaryPromptVariables, buildResolvedDailySummaryUserPrompt };
