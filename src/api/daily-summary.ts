/**
 * Daily Summary Service (Facade)
 *
 * Re-exports everything from the repository and generator modules.
 * Provides wrapper functions that combine generation + notification push
 * for backward compatibility with existing callers.
 *
 * New code should import directly from:
 * - src/api/daily-summary-repository.js (DB operations)
 * - src/api/daily-summary-generator.js (pure generation)
 *
 * And handle push notifications explicitly in the scheduler/API layer.
 */

import { logger } from '../logger.js';
import { getTelegramNotifier } from '../telegram/index.js';
import { getWeChatNotifier } from '../wechat/index.js';

// Re-export everything from repository
export {
  getDailyPassedArticles,
  saveDailySummary,
  getDailySummaryByDate,
  getDailySummaryHistory,
  getTodaySummary,
  getAllJournalArticles,
  getInsightsArticles,
} from './daily-summary-repository.js';

export type {
  SummaryType,
  DailySummaryArticle,
  DailySummaryInput,
  DailySummaryResult,
  DailySummaryHistoryItem,
  SaveDailySummaryInput,
} from './daily-summary-repository.js';

// Re-export everything from generator
export {
  generateDailySummary as generateDailySummaryPure,
  generateJournalAllSummary as generateJournalAllSummaryPure,
  generateSearchSummary,
  generateInsightsSummary as generateInsightsSummaryPure,
  buildArticlesListText,
  buildDailySummaryTypeInstruction,
  buildSummaryUserMessage,
  buildDailySummaryPromptVariables,
  buildResolvedDailySummaryUserPrompt,
} from './daily-summary-generator.js';

import {
  generateDailySummary as generateDailySummaryPure,
  generateJournalAllSummary as generateJournalAllSummaryPure,
  generateInsightsSummary as generateInsightsSummaryPure,
} from './daily-summary-generator.js';

import {
  saveDailySummary,
  type SummaryType,
  type DailySummaryInput,
  type DailySummaryResult,
  type DailySummaryArticle,
} from './daily-summary-repository.js';

const log = logger.child({ module: 'daily-summary-facade' });

// ============================================================================
// Wrapper Functions (Generation + Save + Push)
// ============================================================================

/**
 * Generate daily summary + push to Telegram/WeChat.
 * Used by API routes for backward compatibility.
 */
export async function generateDailySummary(input: DailySummaryInput): Promise<DailySummaryResult> {
  const result = await generateDailySummaryPure(input);

  // Push to Telegram (async, non-blocking)
  if (result.type === 'journal' || result.type === 'blog_news' || result.type === 'all') {
    getTelegramNotifier().sendDailySummary(input.userId, {
      date: result.date,
      type: result.type,
      totalArticles: result.totalArticles,
      summary: result.summary,
      articlesByType: {
        journal: result.articlesByType.journal.length,
        blog: result.articlesByType.blog.length,
        news: result.articlesByType.news.length,
        email: result.articlesByType.email.length,
      },
    }).catch(err => {
      log.warn({ error: err }, 'Failed to send daily summary to Telegram');
    });
  }

  // Push to WeChat (async, non-blocking)
  getWeChatNotifier().sendDailySummary(input.userId, {
    date: result.date,
    type: result.type,
    totalArticles: result.totalArticles,
    summary: result.summary,
    articlesByType: {
      journal: result.articlesByType.journal.length,
      blog: result.articlesByType.blog.length,
      news: result.articlesByType.news.length,
      email: result.articlesByType.email.length,
    },
  }).catch(err => {
    log.warn({ error: err }, 'Failed to send daily summary to WeChat');
  });

  return result;
}

/**
 * Generate all-journal summary + save to DB + push to Telegram/WeChat.
 * Used by API routes for backward compatibility.
 */
export async function generateJournalAllSummary(input: Omit<DailySummaryInput, 'type' | 'limit'>): Promise<DailySummaryResult> {
  const result = await generateJournalAllSummaryPure(input);

  // Save to DB (matching old behavior — the pure generator doesn't save)
  if (result.totalArticles > 0) {
    await saveDailySummary({
      userId: input.userId,
      date: result.date,
      type: result.type,
      articleCount: result.totalArticles,
      summaryContent: result.summary,
      articlesData: result.articlesByType,
    }).catch(err => {
      log.warn({ error: err }, 'Failed to save journal all summary');
    });
  }

  // Push to Telegram (async, non-blocking)
  getTelegramNotifier().sendJournalAllSummary(input.userId, {
    date: result.date,
    type: 'journal_all',
    totalArticles: result.totalArticles,
    summary: result.summary,
    articlesByType: {
      journal: result.articlesByType.journal.length,
      blog: 0,
      news: 0,
      email: 0,
    },
  }).catch(err => {
    log.warn({ error: err }, 'Failed to send journal all summary to Telegram');
  });

  // Push to WeChat (async, non-blocking)
  const allArticles = [...result.articlesByType.journal, ...result.articlesByType.blog, ...result.articlesByType.news, ...result.articlesByType.email];
  getWeChatNotifier().sendJournalAllSummary(input.userId, {
    date: result.date,
    totalArticles: result.totalArticles,
    summary: result.summary,
    articles: allArticles,
  }).catch(err => {
    log.warn({ error: err }, 'Failed to send journal all summary to WeChat');
  });

  return result;
}

/**
 * Generate insights summary + save to DB + push to Telegram/WeChat.
 * Used by API routes for backward compatibility.
 */
export async function generateInsightsSummary(input: { userId: number; days?: number }): Promise<DailySummaryResult> {
  const result = await generateInsightsSummaryPure(input);

  // Save to DB (matching old behavior — the pure generator doesn't save)
  if (result.totalArticles > 0) {
    const { getUserLocalDate } = await import('./timezone.js');
    const executionDate = await getUserLocalDate(input.userId);
    await saveDailySummary({
      userId: input.userId,
      date: executionDate,
      type: 'insights',
      articleCount: result.totalArticles,
      summaryContent: result.summary,
      articlesData: result.articlesByType,
    }).catch(err => {
      log.warn({ error: err }, 'Failed to save insights summary');
    });
  }

  // Push to Telegram (async, non-blocking)
  getTelegramNotifier().sendInsightsSummary(input.userId, {
    date: result.date,
    type: 'insights',
    totalArticles: result.totalArticles,
    summary: result.summary,
    articlesByType: {
      journal: result.articlesByType.journal.length,
      blog: result.articlesByType.blog.length,
      news: result.articlesByType.news.length,
      email: result.articlesByType.email.length,
    },
  }).catch(err => {
    log.warn({ error: err }, 'Failed to send insights summary to Telegram');
  });

  // Push to WeChat (async, non-blocking)
  getWeChatNotifier().sendInsightsSummary(input.userId, {
    date: result.date,
    type: 'insights',
    totalArticles: result.totalArticles,
    summary: result.summary,
    articlesByType: {
      journal: result.articlesByType.journal.length,
      blog: result.articlesByType.blog.length,
      news: result.articlesByType.news.length,
      email: result.articlesByType.email.length,
    },
  }).catch(err => {
    log.warn({ error: err }, 'Failed to send insights summary to WeChat');
  });

  return result;
}
