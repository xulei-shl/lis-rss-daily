import { getConfig, loadConfig } from './config.js';
import { getArticleById, getArticlesByIds } from './database.js';
import { getUserLLMProvider, type LLMProvider, type ChatMessage } from './llm.js';
import { semanticSearch, relatedSearch, filterByScore, mergeResults } from './search.js';
import { callPdfApiWithRetry } from './pdf-api.js';
import { ensureOutputDir, writeStepReport, saveArticleMD, generateArticleSummaryMD, getReportPath, getArticlesDir } from './report.js';
import { parseSeedFileToArticles } from './md-parser.js';
import type { SeedArticle, CandidateArticle, DeepSearchResult } from './types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.join(__dirname, 'prompts');

function loadPromptTemplate(promptName: string): string {
  const filePath = path.join(PROMPTS_DIR, `${promptName}.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`提示词文件不存在: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function renderPrompt(template: string, variables: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(variables)) {
    const pattern = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
    output = output.replace(pattern, value);
  }
  return output;
}

async function generateSearchTerms(
  articles: SeedArticle[],
  llm: LLMProvider,
  config: ReturnType<typeof getConfig>
): Promise<string[]> {
  const searchTerms: string[] = [];
  const promptTemplate = loadPromptTemplate(config.search.prompt);

  for (const article of articles) {
    const content = article.aiSummary ?? article.markdownContent ?? article.content ?? '';
    if (!content) continue;

    const userPrompt = renderPrompt(promptTemplate, {
      title: article.title,
      content: content.slice(0, 2000),
    });

    const messages: ChatMessage[] = [
      { role: 'user', content: userPrompt },
    ];

    try {
      const response = await llm.chat(messages, {
        temperature: config.llm.temperature,
        maxTokens: config.llm.max_tokens,
        jsonMode: true,
        label: 'generate-search-terms',
      });

      const parsed = JSON.parse(response);
      if (parsed.search_queries && Array.isArray(parsed.search_queries)) {
        searchTerms.push(...parsed.search_queries);
      }
    } catch (error) {
      console.error(`生成检索词失败: ${article.title}`, error);
    }
  }

  return [...new Set(searchTerms)];
}

async function searchRelatedByIds(
  seedArticles: SeedArticle[],
  limit: number
): Promise<CandidateArticle[]> {
  const results: CandidateArticle[] = [];

  for (const article of seedArticles) {
    if (article.articleId === null) continue;

    const related = await relatedSearch(article.articleId, limit);
    results.push(...related);
  }

  return results;
}

async function iterativeSearch(
  seedArticles: SeedArticle[],
  rounds: number,
  scoreThreshold: number,
  semanticLimit: number
): Promise<CandidateArticle[]> {
  const config = getConfig();
  const allCandidateIds = new Set<number>();
  let candidates: CandidateArticle[] = [];
  let currentSeeds = seedArticles;

  for (let round = 0; round < rounds; round++) {
    console.log(`[迭代 ${round + 1}/${rounds}] 开始检索...`);

    const relatedFromIds = await searchRelatedByIds(currentSeeds, semanticLimit);
    console.log(`  - 从 ID 检索到 ${relatedFromIds.length} 篇文章`);

    try {
      const llm = await getUserLLMProvider(config.llm.task_type ?? undefined);
      const searchTerms = await generateSearchTerms(currentSeeds, llm, config);
      console.log(`  - 生成检索词: ${searchTerms.join(', ')}`);

      const searchResults: CandidateArticle[] = [];
      for (const term of searchTerms.slice(0, 3)) {
        const semanticResults = await semanticSearch(term, semanticLimit);
        searchResults.push(...semanticResults);
      }

      const merged = mergeResults(relatedFromIds, searchResults);
      const filtered = filterByScore(merged, scoreThreshold);

      console.log(`  - 合并后候选文章: ${filtered.length} 篇`);

      filtered.forEach((c) => {
        if (c.articleId !== null) {
          allCandidateIds.add(c.articleId);
        }
      });

      candidates = filtered;

      if (candidates.length > 0) {
        const newSeeds: SeedArticle[] = [];
        for (const c of candidates.slice(0, 5)) {
          if (c.articleId !== null) {
            const article = await getArticleById(c.articleId);
            if (article) {
              newSeeds.push({
                articleId: article.id,
                title: article.title,
                aiSummary: article.ai_summary,
                markdownContent: article.markdown_content,
                content: article.content,
              });
            }
          }
        }
        if (newSeeds.length > 0) {
          currentSeeds = newSeeds;
        }
      }
    } catch (error) {
      console.error(`迭代 ${round + 1} 失败:`, error);
    }
  }

  const finalCandidates: CandidateArticle[] = [];
  const idToCandidate = new Map<number, CandidateArticle>();

  for (const c of candidates) {
    if (c.articleId !== null && !idToCandidate.has(c.articleId)) {
      idToCandidate.set(c.articleId, c);
    }
  }

  for (const [, candidate] of idToCandidate) {
    finalCandidates.push(candidate);
  }

  return finalCandidates;
}

async function processPdfSummary(
  candidates: CandidateArticle[]
): Promise<{ success: number; failed: number; skipped: number }> {
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    console.log(`[PDF 总结] ${candidate.title}...`);

    try {
      let pdfResult = null;

      if (candidate.articleId !== null) {
        const article = await getArticleById(candidate.articleId);

        if (article?.ai_summary) {
          console.log(`  - 已有摘要，跳过 PDF 总结`);
          skipped++;
        } else {
          pdfResult = await callPdfApiWithRetry(candidate.title, candidate.articleId);
          if (pdfResult.success) {
            success++;
          } else {
            failed++;
            console.log(`  - PDF 总结失败: ${pdfResult.reason}`);
          }
        }

        const content = article?.ai_summary || article?.markdown_content || article?.content || '';
        const mdContent = await generateArticleSummaryMD(
          candidate.articleId,
          candidate.title,
          content,
          pdfResult?.success ?? false,
          pdfResult?.reason
        );
        await saveArticleMD(candidate.articleId, candidate.title, mdContent);
      } else {
        pdfResult = await callPdfApiWithRetry(candidate.title, null);
        if (pdfResult.success) {
          success++;
        } else {
          failed++;
        }

        const mdContent = await generateArticleSummaryMD(
          null,
          candidate.title,
          pdfResult.md_path ? `PDF 原文路径: ${pdfResult.pdf_path}` : '',
          pdfResult.success,
          pdfResult.reason
        );
        await saveArticleMD(null, candidate.title, mdContent);
      }
    } catch (error) {
      failed++;
      console.error(`  - PDF 总结异常:`, error);
    }
  }

  return { success, failed, skipped };
}

export interface DeepSearchOptions {
  inputMd: string;
  rounds?: number;
  scoreThreshold?: number;
  semanticLimit?: number;
  outputDir?: string;
  configPath?: string;
}

export async function runDeepSearch(options: DeepSearchOptions): Promise<DeepSearchResult> {
  if (options.configPath) {
    loadConfig(options.configPath);
  }

  const config = getConfig();
  ensureOutputDir();

  console.log('='.repeat(50));
  console.log('DeepSearch 开始执行');
  console.log('='.repeat(50));

  await writeStepReport('步骤一：检索相关文章', '开始解析输入文件...');

  const seedArticles = await parseSeedFileToArticles(options.inputMd);
  console.log(`解析到 ${seedArticles.length} 个种子文章`);

  const report = `解析到 ${seedArticles.length} 个种子文章:\n${seedArticles.map((a) => `- ${a.title}${a.articleId ? ` (ID: ${a.articleId})` : ''}`).join('\n')}`;
  await writeStepReport('步骤一：检索相关文章', report);

  const rounds = options.rounds ?? config.search.iteration_rounds;
  const threshold = options.scoreThreshold ?? config.search.score_threshold;
  const limit = options.semanticLimit ?? config.search.semantic_limit;

  console.log(`\n开始迭代检索 (轮次: ${rounds}, 阈值: ${threshold}, 限制: ${limit})`);
  await writeStepReport('步骤一：检索相关文章', `迭代检索参数: 轮次=${rounds}, 阈值=${threshold}, 限制=${limit}`);

  const candidates = await iterativeSearch(seedArticles, rounds, threshold, limit);

  console.log(`\n检索完成，找到 ${candidates.length} 篇候选文章`);
  const candidateList = candidates.map((c) => `- ${c.title} (得分: ${c.score.toFixed(2)}, 来源: ${c.source})`).join('\n');
  await writeStepReport('步骤一：检索相关文章', `找到 ${candidates.length} 篇候选文章:\n${candidateList}`);

  await writeStepReport('步骤二：PDF 总结', `开始处理 ${candidates.length} 篇文章的 PDF 总结...`);

  const pdfResult = await processPdfSummary(candidates);

  console.log(`\nPDF 总结完成: 成功 ${pdfResult.success}, 失败 ${pdfResult.failed}, 跳过 ${pdfResult.skipped}`);
  await writeStepReport(
    '步骤二：PDF 总结',
    `PDF 总结完成:\n- 成功: ${pdfResult.success}\n- 失败: ${pdfResult.failed}\n- 跳过: ${pdfResult.skipped}`
  );

  console.log('='.repeat(50));
  console.log('DeepSearch 执行完成');
  console.log('='.repeat(50));

  return {
    reportPath: getReportPath(),
    articlesDir: getArticlesDir(),
    articleCount: candidates.length,
    pdfSummarySuccess: pdfResult.success,
    pdfSummaryFailed: pdfResult.failed,
    pdfSummarySkipped: pdfResult.skipped,
  };
}