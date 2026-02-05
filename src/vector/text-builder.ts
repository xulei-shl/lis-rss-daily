export function buildVectorText(input: {
  title: string;
  summary: string | null;
  content: string | null;
  markdown_content: string | null;
}): string {
  const parts: string[] = [];
  const title = input.title?.trim() || '';
  if (title) {
    parts.push(`TITLE: ${title}`);
  }

  const summary = input.summary?.trim() || '';
  if (summary) {
    parts.push(`SUMMARY: ${summary}`);
  }

  const content = (input.markdown_content || input.content || '').trim();
  if (content) {
    parts.push(`CONTENT: ${content}`);
  }

  return parts.join('\n');
}
