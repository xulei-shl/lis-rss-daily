/**
 * 简单的 HTML -> Markdown 转换工具
 * 适用于 RSS 内容的轻量转换，避免引入额外依赖
 */

/**
 * 将可能是 HTML 的文本转换为简单 Markdown
 */
export function toSimpleMarkdown(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const hasHtml = /<[^>]+>/.test(trimmed);
  const normalized = hasHtml ? htmlToSimpleMarkdown(cleanHtml(trimmed)) : trimmed;
  return cleanupMarkdown(normalized);
}

/**
 * 简单 HTML 转 Markdown（不依赖第三方库）
 */
function htmlToSimpleMarkdown(html: string): string {
  if (!html) return '';

  let md = html;

  // 标题
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');

  // 段落与换行
  md = md.replace(/<p[^>]*>/gi, '\n\n');
  md = md.replace(/<\/p>/gi, '');
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // 粗体与斜体
  md = md.replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>(.*?)<\/(em|i)>/gi, '*$2*');

  // 链接
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // 代码
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*>(.*?)<\/pre>/gis, '\n```\n$1\n```\n');

  // 列表
  md = md.replace(/<li[^>]*>/gi, '- ');
  md = md.replace(/<\/li>/gi, '\n');
  md = md.replace(/<\/?[uo]l[^>]*>/gi, '\n');

  // 引用
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (_, content) => {
    return content
      .split('\n')
      .map((line: string) => `> ${line}`)
      .join('\n');
  });

  // 图片（不保留）
  md = md.replace(/<img[^>]*>/gi, '');

  // 去掉其余 HTML 标签
  md = md.replace(/<[^>]+>/g, '');

  // 解码 HTML 实体
  md = md.replace(/&amp;/g, '&');
  md = md.replace(/&lt;/g, '<');
  md = md.replace(/&gt;/g, '>');
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, ' ');

  // 清理多余空行
  md = md.replace(/\n{3,}/g, '\n\n');
  md = md.trim();

  return md;
}

/**
 * 简单 HTML 清洗，移除常见噪声区块
 */
function cleanHtml(html: string): string {
  let cleaned = html;

  // 移除脚本/样式/表单/导航等
  cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
  cleaned = cleaned.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  cleaned = cleaned.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  cleaned = cleaned.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  cleaned = cleaned.replace(/<form[\s\S]*?<\/form>/gi, '');

  // 移除常见噪声块（通过 class/id 关键字）
  cleaned = cleaned.replace(
    /<([a-z0-9]+)[^>]*(class|id)=["'][^"']*(comment|share|cookie|subscribe|banner|footer|header|nav|sidebar|advert|promo|ads?)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
    ''
  );

  // 移除图片标签
  cleaned = cleaned.replace(/<img[^>]*>/gi, '');

  return cleaned;
}

/**
 * Markdown 清理与去噪
 */
function cleanupMarkdown(md: string): string {
  if (!md) return '';
  const withoutImages = md.replace(/!\[[^\]]*\]\([^\)]*\)/g, '');
  const lines = withoutImages
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const noiseKeywords = [
    '订阅',
    '关注我们',
    '免责声明',
    '版权',
    'cookie',
    'privacy',
    'subscribe',
    'newsletter',
    'share',
    'advert',
  ];

  const filtered = lines.filter((line) => {
    const lower = line.toLowerCase();
    if (line.length <= 2) return false;
    return !noiseKeywords.some((k) => lower.includes(k));
  });

  return filtered.join('\n\n').trim();
}
