import fs from 'fs';
import path from 'path';
import { getConfig } from './config.js';
import type { CandidateArticle, ArticleMDResult } from './types.js';

let cachedReportPath: string | null = null;
let cachedOutputDir: string | null = null;

export function initOutputDir(): string {
  if (cachedOutputDir) {
    return cachedOutputDir;
  }
  
  const config = getConfig();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  cachedOutputDir = path.join(config.output.base_dir, `run_${timestamp}`);
  
  if (!fs.existsSync(cachedOutputDir)) {
    fs.mkdirSync(cachedOutputDir, { recursive: true });
  }
  
  const articlesDir = path.join(cachedOutputDir, 'articles');
  if (!fs.existsSync(articlesDir)) {
    fs.mkdirSync(articlesDir, { recursive: true });
  }
  
  return cachedOutputDir;
}

export function ensureOutputDir(): void {
  initOutputDir();
}

export function getReportPath(): string {
  if (cachedReportPath) {
    return cachedReportPath;
  }
  
  const outputDir = initOutputDir();
  cachedReportPath = path.join(outputDir, 'report.md');
  
  const header = `# DeepSearch 运行报告\n\n生成时间: ${new Date().toISOString()}\n\n---\n\n`;
  fs.writeFileSync(cachedReportPath, header, 'utf8');
  
  return cachedReportPath;
}

export function getArticlesDir(): string {
  const outputDir = initOutputDir();
  return path.join(outputDir, 'articles');
}

export function getOutputDir(): string {
  return initOutputDir();
}

export async function appendToReport(content: string): Promise<void> {
  const reportPath = getReportPath();
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
  pdfReason?: string,
  skipped?: boolean
): Promise<string> {
  let statusEmoji = '✅';
  let statusText = '';

  if (skipped) {
    statusEmoji = '⏭️';
    statusText = '已有摘要，跳过 PDF 总结';
  } else if (pdfSuccess) {
    statusText = 'PDF 总结成功';
  } else {
    statusText = `PDF 总结失败: ${pdfReason || '未知错误'}`;
  }

  const mdContent = `---
title: ${title}
article_id: ${articleId ?? 'N/A'}
pdf_success: ${pdfSuccess}
pdf_skipped: ${skipped || false}
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