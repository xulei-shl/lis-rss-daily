export function buildVectorText(input: {
  title: string;
  content: string | null;
  markdown_content: string | null;
}): string {
  const parts: string[] = [];
  const title = input.title?.trim() || '';
  if (title) {
    parts.push(`TITLE: ${title}`);
  }

  const content = (input.markdown_content || input.content || '').trim();
  if (content) {
    parts.push(`CONTENT: ${content}`);
  }

  return parts.join('\n');
}
