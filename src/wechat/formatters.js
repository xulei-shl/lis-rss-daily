"use strict";
/**
 * 企业微信消息格式化器
 *
 * 将数据格式化为企业微信 Markdown 消息，处理长度限制。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDailySummary = formatDailySummary;
exports.formatJournalAllSummary = formatJournalAllSummary;
exports.formatNewArticle = formatNewArticle;
exports.formatTestMessage = formatTestMessage;
/**
 * 将 Markdown 转换为企业微信支持的 Markdown 格式
 *
 * 企业微信 Markdown 支持的语法：
 * - 标题：# 标题
 * - 加粗：**内容**
 * - 链接：[文本](链接)
 * - 引用：> 引用内容
 * - 代码行：`代码`
 * - 颜色：<font color="info">绿色</font>, <font color="comment">灰色</font>, <font color="warning">橙色</font>
 */
function convertToWeChatMarkdown(markdown) {
    var result = markdown;
    // 企业微信 Markdown 本身支持基本的 Markdown 语法
    // 这里只做一些必要的清理和长度处理
    // 确保链接格式正确
    // 企业微信支持标准的 Markdown 链接格式 [text](url)
    return result;
}
// 截断函数已废弃，不再使用
// 现在由 client.ts 自动处理超长消息分条发送
/**
 * 格式化每日总结消息（通过的期刊/资讯）
 */
function formatDailySummary(data) {
    var date = data.date, type = data.type, totalArticles = data.totalArticles, summary = data.summary, articlesByType = data.articlesByType;
    // 构建头部
    var message = '# 📅 每日总结\n\n';
    message += "**\u65E5\u671F\uFF1A** ".concat(date, "\n\n");
    // 类型标签
    var typeLabels = {
        journal: '期刊精选',
        blog_news: '博客资讯',
        all: '综合总结',
        search: '搜索总结',
        journal_all: '全部期刊', // 理论上不会用在这里
    };
    message += "**\u7C7B\u578B\uFF1A** ".concat(typeLabels[type] || type, "\n\n");
    // 统计信息
    message += '## 📊 统计\n';
    if (articlesByType.journal > 0) {
        message += "- \u671F\u520A\u7CBE\u9009\uFF1A".concat(articlesByType.journal, " \u7BC7\n");
    }
    if (articlesByType.blog > 0) {
        message += "- \u535A\u5BA2\u63A8\u8350\uFF1A".concat(articlesByType.blog, " \u7BC7\n");
    }
    if (articlesByType.news > 0) {
        message += "- \u8D44\u8BAF\u52A8\u6001\uFF1A".concat(articlesByType.news, " \u7BC7\n");
    }
    message += "- \u603B\u8BA1\uFF1A".concat(totalArticles, " \u7BC7\n\n");
    // 总结内容
    message += '## 📝 内容摘要\n';
    var processedSummary = convertToWeChatMarkdown(summary);
    message += processedSummary;
    return message;
}
/**
 * 格式化全部期刊总结消息
 */
function formatJournalAllSummary(data) {
    var date = data.date, totalArticles = data.totalArticles, summary = data.summary, articles = data.articles;
    // 构建头部
    var message = '# 📚 期刊文章每日总结\n\n';
    message += "**\u65E5\u671F\uFF1A** ".concat(date, "\n\n");
    // 统计信息
    message += '## 📊 统计\n';
    message += "- \u6587\u7AE0\u603B\u6570\uFF1A".concat(totalArticles, " \u7BC7\n\n");
    // 总结内容
    message += '## 📝 内容摘要\n';
    var processedSummary = convertToWeChatMarkdown(summary);
    message += processedSummary;
    // 文章列表（最多 50 篇）
    if (articles.length > 0) {
        message += '\n## 📄 文章列表\n';
        var maxArticles = Math.min(articles.length, 50);
        for (var i = 0; i < maxArticles; i++) {
            var article = articles[i];
            var safeTitle = article.title.replace(/\[/g, '[').replace(/\]/g, ']');
            message += "".concat(i + 1, ". [").concat(safeTitle, "](").concat(article.url, ")\n");
            message += "   \u6765\u6E90\uFF1A".concat(article.source_name, "\n\n");
        }
        if (articles.length > 50) {
            message += "... \u8FD8\u6709 ".concat(articles.length - 50, " \u7BC7\u6587\u7AE0\n");
        }
    }
    return message;
}
/**
 * 格式化新增文章通知
 */
function formatNewArticle(data) {
    var message = '# 🆕 新增文章\n\n';
    if (data.id !== undefined) {
        message += "**ID\uFF1A** ".concat(data.id, "\n");
    }
    message += "\u3010".concat(data.sourceType, "\u3011").concat(data.sourceName, "\n\n");
    var safeTitle = data.title.replace(/\[/g, '[').replace(/\]/g, ']');
    message += "**\u6807\u9898\uFF1A** [".concat(safeTitle, "](").concat(data.url, ")\n");
    // 添加内容预览
    var preview = data.summary || data.markdown_content || '';
    if (preview) {
        var maxPreview = 500;
        if (preview.length > maxPreview) {
            preview = preview.substring(0, maxPreview) + '...';
        }
        preview = convertToWeChatMarkdown(preview);
        message += "\n**\u6458\u8981\uFF1A**\n".concat(preview, "\n");
    }
    message += "\n\uD83D\uDD17 [\u67E5\u770B\u539F\u6587](".concat(data.url, ")");
    return message;
}
/**
 * 格式化测试消息
 */
function formatTestMessage() {
    return '# 🔔 测试消息\n\n这是一条来自 LIS-RSS 的企业微信测试消息。\n\n如果您收到这条消息，说明配置成功！';
}
