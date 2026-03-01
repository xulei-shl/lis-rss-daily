/**
 * Telegram Message Formatters
 *
 * Format data into Telegram messages with appropriate length limits.
 */

import type { DailySummaryData } from './types.js';

const MAX_MESSAGE_LENGTH = 4096;
const MAX_SUMMARY_LENGTH = 3500; // Leave room for header and footer

/**
 * Format daily summary data into a Telegram message
 */
export function formatDailySummary(data: DailySummaryData): string {
  const { date, type, totalArticles, summary, articlesByType } = data;

  // Header
  let message = '📅 每日文献总结\n';
  message += `🗓 ${date}\n\n`;

  // Type label
  const typeLabels: Record<string, string> = {
    journal: '期刊精选',
    blog_news: '博客资讯',
    all: '综合总结',
  };
  message += `📋 类型：${typeLabels[type] || type}\n\n`;

  // Statistics
  message += '📊 统计\n';
  if (articlesByType.journal > 0) {
    message += `  期刊精选: ${articlesByType.journal} 篇\n`;
  }
  if (articlesByType.blog > 0) {
    message += `  博客推荐: ${articlesByType.blog} 篇\n`;
  }
  if (articlesByType.news > 0) {
    message += `  资讯动态: ${articlesByType.news} 篇\n`;
  }
  message += `  总计: ${totalArticles} 篇\n\n`;

  // Summary content (truncate if necessary)
  message += '📝 内容摘要\n';
  const truncatedSummary = summary.length > MAX_SUMMARY_LENGTH
    ? summary.substring(0, MAX_SUMMARY_LENGTH) + '\n\n...'
    : summary;
  message += truncatedSummary;

  // Ensure total message length is within Telegram's limit
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.substring(0, MAX_MESSAGE_LENGTH - 3) + '...';
  }

  return message;
}

/**
 * Format new article notification (for future use)
 */
export function formatNewArticle(data: {
  title: string;
  url: string;
  sourceName: string;
  sourceType: string;
  summary?: string;
}): string {
  let message = '🆕 新文献推荐\n\n';
  message += `【${data.sourceType}】${data.sourceName}\n\n`;
  message += `标题: ${data.title}\n`;

  if (data.summary) {
    const maxPreview = 500;
    const preview = data.summary.length > maxPreview
      ? data.summary.substring(0, maxPreview) + '...'
      : data.summary;
    message += `\n摘要: ${preview}\n`;
  }

  message += `\n🔗 ${data.url}`;

  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.substring(0, MAX_MESSAGE_LENGTH - 3) + '...';
  }

  return message;
}
