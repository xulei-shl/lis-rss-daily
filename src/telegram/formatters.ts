/**
 * Telegram Message Formatters
 *
 * Format data into Telegram messages with appropriate length limits.
 */

import type { DailySummaryData, InlineKeyboardMarkup } from './types.js';

const MAX_MESSAGE_LENGTH = 4096;
const MAX_SUMMARY_LENGTH = 3500; // Leave room for header and footer

/**
 * Format daily summary data into a Telegram message (HTML format)
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
  message += `📋 <b>类型：</b>${typeLabels[type] || type}\n\n`;

  // Statistics
  message += '📊 <b>统计</b>\n';
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

  // Summary content - convert Markdown to HTML
  message += '📝 <b>内容摘要</b>\n';
  const htmlSummary = convertMarkdownToHTML(summary);
  const truncatedSummary = htmlSummary.length > MAX_SUMMARY_LENGTH
    ? htmlSummary.substring(0, MAX_SUMMARY_LENGTH) + '\n\n...'
    : htmlSummary;
  message += truncatedSummary;

  // Ensure total message length is within Telegram's limit
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.substring(0, MAX_MESSAGE_LENGTH - 3) + '...';
  }

  return message;
}

/**
 * Convert Markdown to simple HTML for Telegram
 * Telegram HTML supports: b, i, u, s, code, pre, a, br
 */
function convertMarkdownToHTML(markdown: string): string {
  let html = markdown;

  // Escape HTML special chars first (except < > for tags we'll create)
  html = html.replace(/&/g, '&amp;');

  // Headers to bold
  html = html.replace(/^####\s+(.*)$/gm, '<b>$1</b>');
  html = html.replace(/^###\s+(.*)$/gm, '<b>$1</b>');
  html = html.replace(/^##\s+(.*)$/gm, '<b>$1</b>');
  html = html.replace(/^#\s+(.*)$/gm, '<b>$1</b>');

  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/__(.+?)__/g, '<b>$1</b>');

  // Italic: *text* or _text_ (but not ** or __)
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>');
  html = html.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<i>$1</i>');

  // Code: `text` to <code>text</code>
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links: [text](url) to <a href="url">text</a>
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Lists: - item to • item
  html = html.replace(/^[\-\*]\s+/gm, '• ');

  // Numbered lists keep as is

  // Horizontal rules
  html = html.replace(/^---+$/gm, '─────────');

  // Escape remaining < > that aren't part of our tags
  html = html.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Restore our tags
  html = html.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
  html = html.replace(/&lt;i&gt;/g, '<i>').replace(/&lt;\/i&gt;/g, '</i>');
  html = html.replace(/&lt;code&gt;/g, '<code>').replace(/&lt;\/code&gt;/g, '</code>');
  html = html.replace(/&lt;a href=/g, '<a href=').replace(/&lt;\/a&gt;/g, '</a>');

  return html;
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

/**
 * Create article action keyboard
 * @param articleId - Article ID
 * @param isRead - Current read status
 * @param currentRating - Current rating (1-5 or null)
 */
export function createArticleKeyboard(
  articleId: number,
  isRead: boolean,
  currentRating: number | null
): InlineKeyboardMarkup {
  // Rating button text
  let ratingText = '⭐ 评分';
  if (currentRating !== null) {
    ratingText = '⭐'.repeat(currentRating);
  }

  // Read status button text
  const readText = isRead ? '✅ 已读' : '📖 标记已读';

  return {
    inline_keyboard: [
      [
        { text: ratingText, callback_data: `sr:${articleId}` },
      ],
      [
        { text: readText, callback_data: `mr:${articleId}` },
      ],
    ],
  };
}

/**
 * Create rating selection keyboard
 * @param articleId - Article ID
 */
export function createRatingKeyboard(
  articleId: number
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '1⃣', callback_data: `rt:${articleId}:1` },
        { text: '2⃣', callback_data: `rt:${articleId}:2` },
        { text: '3⃣', callback_data: `rt:${articleId}:3` },
      ],
      [
        { text: '4⃣', callback_data: `rt:${articleId}:4` },
        { text: '5⃣', callback_data: `rt:${articleId}:5` },
        { text: '', callback_data: '' }, // Empty placeholder
      ].filter((btn) => btn.text !== ''), // Remove empty button
      [
        { text: '❌ 取消', callback_data: `cl:${articleId}` },
      ],
    ],
  };
}

/**
 * Create empty keyboard (to remove inline keyboard)
 */
export function createEmptyKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [],
  };
}
