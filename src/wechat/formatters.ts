/**
 * 企业微信消息格式化器
 *
 * 将数据格式化为企业微信 Markdown 消息，处理长度限制。
 */

import type { SummaryType, DailySummaryArticle } from '../api/daily-summary.js';

// 注意：现在 client.ts 会自动处理超长消息分条发送
// 这里不再需要截断逻辑，保持消息完整即可

/**
 * 企业微信每日总结数据接口
 */
export interface WeChatDailySummaryData {
  date: string;
  type: SummaryType;
  totalArticles: number;
  summary: string;
  articlesByType: {
    journal: number;
    blog: number;
    news: number;
  };
}

/**
 * 全部期刊总结数据接口
 */
export interface JournalAllSummaryData {
  date: string;
  totalArticles: number;
  summary: string;
  articles: DailySummaryArticle[];
}

/**
 * 新增文章数据接口
 */
export interface NewArticleData {
  id?: number;
  title: string;
  url: string;
  sourceName: string;
  sourceType: string;
  summary?: string;
  markdown_content?: string;
}

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
function convertToWeChatMarkdown(markdown: string): string {
  let result = markdown;

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
export function formatDailySummary(data: WeChatDailySummaryData): string {
  const { date, type, totalArticles, summary, articlesByType } = data;

  // 构建头部
  let message = '# 📅 每日总结\n\n';
  message += `**日期：** ${date}\n\n`;

  // 类型标签
  const typeLabels: Record<string, string> = {
    journal: '期刊精选',
    blog_news: '博客资讯',
    all: '综合总结',
    search: '搜索总结',
    journal_all: '全部期刊', // 理论上不会用在这里
  };
  message += `**类型：** ${typeLabels[type] || type}\n\n`;

  // 统计信息
  message += '## 📊 统计\n';
  if (articlesByType.journal > 0) {
    message += `- 期刊精选：${articlesByType.journal} 篇\n`;
  }
  if (articlesByType.blog > 0) {
    message += `- 博客推荐：${articlesByType.blog} 篇\n`;
  }
  if (articlesByType.news > 0) {
    message += `- 资讯动态：${articlesByType.news} 篇\n`;
  }
  message += `- 总计：${totalArticles} 篇\n\n`;

  // 总结内容
  message += '## 📝 内容摘要\n';
  const processedSummary = convertToWeChatMarkdown(summary);
  message += processedSummary;

  return message;
}

/**
 * 格式化全部期刊总结消息
 */
export function formatJournalAllSummary(data: JournalAllSummaryData): string {
  const { date, totalArticles, summary, articles } = data;

  // 构建头部
  let message = '# 📚 期刊文章每日总结\n\n';
  message += `**日期：** ${date}\n\n`;

  // 统计信息
  message += '## 📊 统计\n';
  message += `- 文章总数：${totalArticles} 篇\n\n`;

  // 总结内容
  message += '## 📝 内容摘要\n';
  const processedSummary = convertToWeChatMarkdown(summary);
  message += processedSummary;

  // 文章列表（最多 50 篇）
  if (articles.length > 0) {
    message += '\n## 📄 文章列表\n';
    const maxArticles = Math.min(articles.length, 50);
    for (let i = 0; i < maxArticles; i++) {
      const article = articles[i];
      const safeTitle = article.title.replace(/\[/g, '[').replace(/\]/g, ']');
      message += `${i + 1}. [${safeTitle}](${article.url})\n`;
      message += `   来源：${article.source_name}\n\n`;
    }

    if (articles.length > 50) {
      message += `... 还有 ${articles.length - 50} 篇文章\n`;
    }
  }

  return message;
}

/**
 * 格式化新增文章通知
 */
export function formatNewArticle(data: NewArticleData): string {
  let message = '# 🆕 新增文章\n\n';

  if (data.id !== undefined) {
    message += `**ID：** ${data.id}\n`;
  }

  message += `【${data.sourceType}】${data.sourceName}\n\n`;

  const safeTitle = data.title.replace(/\[/g, '[').replace(/\]/g, ']');
  message += `**标题：** [${safeTitle}](${data.url})\n`;

  // 添加内容预览
  let preview = data.summary || data.markdown_content || '';
  if (preview) {
    const maxPreview = 500;
    if (preview.length > maxPreview) {
      preview = preview.substring(0, maxPreview) + '...';
    }
    preview = convertToWeChatMarkdown(preview);
    message += `\n**摘要：**\n${preview}\n`;
  }

  message += `\n🔗 [查看原文](${data.url})`;

  return message;
}

/**
 * 格式化测试消息
 */
export function formatTestMessage(): string {
  return '# 🔔 测试消息\n\n这是一条来自 LIS-RSS 的企业微信测试消息。\n\n如果您收到这条消息，说明配置成功！';
}
