export function buildVectorText(input: {
  title: string;
  content: string | null;
  markdown_content: string | null;
  title_zh?: string | null;
  summary_zh?: string | null;
}): string {
  const parts: string[] = [];

  // 优先使用翻译标题，否则用原标题
  const title = (input.title_zh?.trim() || input.title?.trim() || '');
  if (title) {
    parts.push(`TITLE: ${title}`);
  }

  // 优先使用翻译摘要，否则用原文内容
  const summary = input.summary_zh?.trim() || '';
  if (summary) {
    parts.push(`SUMMARY: ${summary}`);
  }

  const content = (input.markdown_content || input.content || '').trim();
  if (content) {
    parts.push(`CONTENT: ${content}`);
  }

  return parts.join('\n');
}
