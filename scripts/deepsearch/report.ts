import fs from 'fs';
import path from 'path';
import { getConfig } from './config.js';
import type { CandidateArticle, ArticleMDResult } from './types.js';

export function ensureOutputDir(): void {
  const config = getConfig();
  const outputDir = config.output.report_dir;
  const articlesDir = config.output.articles_dir;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  if (!fs.existsSync(articlesDir)) {
    fs.mkdirSync(articlesDir, { recursive: true });
  }
}

export function getReportPath(): string {
  const config = getConfig();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(config.output.report_dir, `report_${timestamp}.md`);
}

export function getArticlesDir(): string {
  const config = getConfig();
  return config.output.articles_dir;
}

export async function appendToReport(content: string): Promise<void> {
  const reportPath = getReportPath();
  const exists = fs.existsSync(reportPath);
  
  if (!exists) {
    const header = `# DeepSearch 运行报告\n\n生成时间: ${new Date().toISOString()}\n\n---\n\n`;
    fs.writeFileSync(reportPath, header, 'utf8');
  }

  fs.appendFileSync(reportPath, content + '\n\n', 'utf8');
}

export async function writeStepReport(
  step: string,
  content: string
): Promise<void> {
  const timestamp = new Date().toISOString();
  const section = `## ${step}\n\n时间: ${timestamp}\n\n${content}\n\n---\n`;
  await appendToReport(section);
}

export async function saveArticleMD(
  articleId: number | null,
  title: string,
  content: string
): Promise<string> {
  const articlesDir = getArticlesDir();
  ensureOutputDir();

  const sanitizedTitle = title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 50);
  const idStr = articleId !== null ? `${articleId}_` : '';
  const fileName = `${idStr}${sanitizedTitle}.md`;
  const filePath = path.join(articlesDir, fileName);

  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

export async function generateArticleSummaryMD(
  articleId: number | null,
  title: string,
  content: string,
  pdfSuccess: boolean,
  pdfReason?: string
): Promise<string> {
  let statusEmoji = pdfSuccess ? '✅' : '❌';
  let statusText = pdfSuccess ? 'PDF 总结成功' : `PDF 总结失败: ${pdfReason}`;

  const mdContent = `---
title: ${title}
article_id: ${articleId ?? 'N/A'}
pdf_success: ${pdfSuccess}
generated_at: ${new Date().toISOString()}
---

# ${title}

${statusEmoji} ${statusText}

---

## 文章内容

${content || '(无内容)'}

---

*此文件由 DeepSearch 自动生成*
`;

  return mdContent;
}