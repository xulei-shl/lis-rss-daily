"use strict";
/**
 * Telegram Message Formatters
 *
 * Format data into Telegram messages with appropriate length limits.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDailySummary = formatDailySummary;
exports.formatNewArticle = formatNewArticle;
exports.createArticleKeyboard = createArticleKeyboard;
exports.createRatingKeyboard = createRatingKeyboard;
exports.createEmptyKeyboard = createEmptyKeyboard;
var MAX_MESSAGE_LENGTH = 4096;
var MAX_SUMMARY_LENGTH = 3500; // Leave room for header and footer
/**
 * Format daily summary data into a Telegram message (HTML format)
 */
function formatDailySummary(data) {
    var date = data.date, type = data.type, totalArticles = data.totalArticles, summary = data.summary, articlesByType = data.articlesByType;
    // Header - change for journal_all type
    var message = type === 'journal_all' ? '📅 全部期刊总结\n' : '📅 每日文献总结\n';
    message += "\uD83D\uDDD3 ".concat(date, "\n\n");
    // Type label
    var typeLabels = {
        journal: '期刊精选',
        blog_news: '博客资讯',
        all: '综合总结',
        journal_all: '全部期刊（含未通过）',
    };
    message += "\uD83D\uDCCB <b>\u7C7B\u578B\uFF1A</b>".concat(typeLabels[type] || type, "\n\n");
    // Statistics
    message += '📊 <b>统计</b>\n';
    if (articlesByType.journal > 0) {
        message += "  \u671F\u520A\u7CBE\u9009: ".concat(articlesByType.journal, " \u7BC7\n");
    }
    if (articlesByType.blog > 0) {
        message += "  \u535A\u5BA2\u63A8\u8350: ".concat(articlesByType.blog, " \u7BC7\n");
    }
    if (articlesByType.news > 0) {
        message += "  \u8D44\u8BAF\u52A8\u6001: ".concat(articlesByType.news, " \u7BC7\n");
    }
    message += "  \u603B\u8BA1: ".concat(totalArticles, " \u7BC7\n\n");
    // Summary content - convert Markdown to HTML
    message += '📝 <b>内容摘要</b>\n';
    var htmlSummary = convertMarkdownToHTML(summary);
    var truncatedSummary = htmlSummary.length > MAX_SUMMARY_LENGTH
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
function convertMarkdownToHTML(markdown) {
    var html = markdown;
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
 * Escape HTML special characters for Telegram HTML parse mode
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
/**
 * Format new article notification (for future use)
 */
function formatNewArticle(data) {
    var message = '🆕 新文献推荐\n\n';
    // Add article ID if provided
    if (data.id !== undefined) {
        message += "<b>ID:</b> ".concat(data.id, "\n");
    }
    message += "\u3010".concat(escapeHtml(data.sourceType), "\u3011").concat(escapeHtml(data.sourceName), "\n\n");
    message += "\u6807\u9898: ".concat(escapeHtml(data.title), "\n");
    if (data.summary) {
        var maxPreview = 500;
        var preview = data.summary.length > maxPreview
            ? data.summary.substring(0, maxPreview) + '...'
            : data.summary;
        message += "\n\u6458\u8981: ".concat(escapeHtml(preview), "\n");
    }
    message += "\n\uD83D\uDD17 ".concat(data.url);
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
function createArticleKeyboard(articleId, isRead, currentRating) {
    // Rating button text
    var ratingText = '⭐ 评分';
    if (currentRating !== null) {
        ratingText = '⭐'.repeat(currentRating);
    }
    // Read status button text
    var readText = isRead ? '✅ 已读' : '📖 标记已读';
    return {
        inline_keyboard: [
            [
                { text: ratingText, callback_data: "sr:".concat(articleId) },
            ],
            [
                { text: readText, callback_data: "mr:".concat(articleId) },
            ],
        ],
    };
}
/**
 * Create rating selection keyboard
 * @param articleId - Article ID
 */
function createRatingKeyboard(articleId) {
    return {
        inline_keyboard: [
            [
                { text: '1⃣', callback_data: "rt:".concat(articleId, ":1") },
                { text: '2⃣', callback_data: "rt:".concat(articleId, ":2") },
                { text: '3⃣', callback_data: "rt:".concat(articleId, ":3") },
            ],
            [
                { text: '4⃣', callback_data: "rt:".concat(articleId, ":4") },
                { text: '5⃣', callback_data: "rt:".concat(articleId, ":5") },
                { text: '', callback_data: '' }, // Empty placeholder
            ].filter(function (btn) { return btn.text !== ''; }), // Remove empty button
            [
                { text: '❌ 取消', callback_data: "cl:".concat(articleId) },
            ],
        ],
    };
}
/**
 * Create empty keyboard (to remove inline keyboard)
 */
function createEmptyKeyboard() {
    return {
        inline_keyboard: [],
    };
}
