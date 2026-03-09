/**
 * 企业微信消息格式化器
 *
 * 将数据格式化为企业微信 Markdown 消息，处理长度限制。
 */

import type { SummaryType, DailySummaryArticle } from '../api/daily-summary.js';

const MAX_MESSAGE_LENGTH = 4096;
const MAX_SUMMARY_LENGTH = 3800; // 留出头部和尾部空间

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

/**
 * 截断 UTF-8 字符串到指定字节数
 * 企业微信限制 Markdown 消息为 4096 字节
 */
function truncateToBytes(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);

  if (bytes.length <= maxBytes) {
    return str;
  }

  // 二分查找找到合适的截断点
  let low = 0;
  let high = str.length;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const sliced = str.substring(0, mid);
    const slicedBytes = encoder.encode(sliced);

    if (slicedBytes.length <= maxBytes - 6) { // 留出 "..." 的空间
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return str.substring(0, best) + '...';
}

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

  // 先拼接看看长度
  const tempMessage = message + processedSummary;
  const encoder = new TextEncoder();

  if (encoder.encode(tempMessage).length <= MAX_MESSAGE_LENGTH) {
    message = tempMessage;
  } else {
    // 需要截断总结
    const headerBytes = encoder.encode(message).length;
    const remainingBytes = MAX_MESSAGE_LENGTH - headerBytes;
    message += truncateToBytes(processedSummary, remainingBytes);
  }

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

  // 文章列表（最多 20 篇）
  const articleSection = '\n## 📄 文章列表\n';
  let articleList = '';

  const maxArticles = Math.min(articles.length, 20);
  for (let i = 0; i < maxArticles; i++) {
    const article = articles[i];
    const safeTitle = article.title.replace(/\[/g, '[').replace(/\]/g, ']');
    articleList += `${i + 1}. [${safeTitle}](${article.url})\n`;
    articleList += `   来源：${article.source_name}\n\n`;
  }

  if (articles.length > 20) {
    articleList += `... 还有 ${articles.length - 20} 篇文章\n`;
  }

  // 计算长度并截断
  const encoder = new TextEncoder();
  const baseMessage = message + processedSummary;
  const baseBytes = encoder.encode(baseMessage).length;
  const articleSectionBytes = encoder.encode(articleSection + articleList).length;

  if (baseBytes + articleSectionBytes <= MAX_MESSAGE_LENGTH) {
    message = baseMessage + articleSection + articleList;
  } else if (baseBytes <= MAX_SUMMARY_LENGTH) {
    // 先加上总结，然后用剩余空间放文章列表
    message = baseMessage;
    const remainingBytes = MAX_MESSAGE_LENGTH - baseBytes - encoder.encode(articleSection).length;
    if (remainingBytes > 100) {
      message += articleSection;
      message += truncateToBytes(articleList, remainingBytes);
    }
  } else {
    // 只放截断的总结
    const headerBytes = encoder.encode('# 📚 期刊文章每日总结\n\n**日期：** ' + date + '\n\n## 📊 统计\n- 文章总数：' + totalArticles + ' 篇\n\n## 📝 内容摘要\n').length;
    message = '# 📚 期刊文章每日总结\n\n';
    message += `**日期：** ${date}\n\n`;
    message += '## 📊 统计\n';
    message += `- 文章总数：${totalArticles} 篇\n\n`;
    message += '## 📝 内容摘要\n';
    message += truncateToBytes(processedSummary, MAX_MESSAGE_LENGTH - headerBytes);
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

  // 确保总长度在限制内
  const encoder = new TextEncoder();
  if (encoder.encode(message).length > MAX_MESSAGE_LENGTH) {
    message = truncateToBytes(message, MAX_MESSAGE_LENGTH);
  }

  return message;
}

/**
 * 格式化测试消息
 */
export function formatTestMessage(): string {
  return '# 🔔 测试消息\n\n这是一条来自 LIS-RSS 的企业微信测试消息。\n\n如果您收到这条消息，说明配置成功！';
}
