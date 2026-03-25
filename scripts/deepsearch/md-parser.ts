import fs from 'fs';
import type { ParsedSeedLine, SeedArticle } from './types.js';
import { getArticleById } from './database.js';

const SEED_LINE_AT_ID_REGEX = /^-\s+(.+)\s*@\s*(\d+)\s*$/;
const SEED_LINE_REGEX = /^-\s+(.+?)\s*[：:]\s*(\d+)\s*$/;
const SEED_LINE_NO_ID_REGEX = /^-\s+(.+)$/;

export function parseSeedFile(content: string): ParsedSeedLine[] {
  const lines = content.split('\n');
  const results: ParsedSeedLine[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith('- ')) {
      continue;
    }

    const withAtIdMatch = trimmedLine.match(SEED_LINE_AT_ID_REGEX);
    if (withAtIdMatch) {
      const title = withAtIdMatch[1].trim();
      const articleId = parseInt(withAtIdMatch[2], 10);
      results.push({ articleId, title });
      continue;
    }

    const withColonIdMatch = trimmedLine.match(SEED_LINE_REGEX);
    if (withColonIdMatch) {
      const title = withColonIdMatch[1].trim();
      const articleId = parseInt(withColonIdMatch[2], 10);
      results.push({ articleId, title });
      continue;
    }

    const noIdMatch = trimmedLine.match(SEED_LINE_NO_ID_REGEX);
    if (noIdMatch) {
      const title = noIdMatch[1].trim();
      results.push({ articleId: null, title });
    }
  }

  return results;
}

export async function parseSeedFileToArticles(content: string): Promise<SeedArticle[]> {
  const parsedLines = parseSeedFile(content);
  const articles: SeedArticle[] = [];

  for (const line of parsedLines) {
    if (line.articleId !== null) {
      const article = await getArticleById(line.articleId);
      if (article) {
        articles.push({
          articleId: article.id,
          title: line.title || article.title,
          aiSummary: article.ai_summary,
          markdownContent: article.markdown_content,
          content: article.content,
        });
      } else {
        console.warn(`文章 ID ${line.articleId} 未找到: ${line.title}`);
        articles.push({
          articleId: line.articleId,
          title: line.title,
        });
      }
    } else {
      articles.push({
        articleId: null,
        title: line.title,
      });
    }
  }

  return articles;
}

export function readInputFile(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`输入文件不存在: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}
