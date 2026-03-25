import { getConfig, loadConfig } from './config.js';
import { getArticleById } from './database.js';
import { getUserLLMProvider, type LLMProvider, type ChatMessage } from './llm.js';
import { semanticSearch, relatedSearch, filterByScore, mergeResults } from './search.js';
import { callPdfApiWithRetry } from './pdf-api.js';
import { configureOutputDir, ensureOutputDir, writeStepReport, saveArticleMD, generateArticleSummaryMD, getReportPath, getArticlesDir, getOutputDir } from './report.js';
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

    const userPrompt = renderPrompt(promptTemplate, {
      title: article.title,
      content: content ? content.slice(0, 2000) : '',
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

      let jsonStr = response.trim();
      if (jsonStr.startsWith('```')) {
        const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
          jsonStr = match[1].trim();
        }
      }

      const parsed = JSON.parse(jsonStr);
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
  semanticLimit: number,
  onLog?: (message: string) => void
): Promise<CandidateArticle[]> {
  const config = getConfig();
  const allCandidateIds = new Set<number>();
  const log = (message: string): void => {
    console.log(message);
    onLog?.(message);
  };
  
  log(`[迭代 0/${rounds}] 种子文章直接检索...`);
  const round0Results = await performSearchRound(seedArticles, semanticLimit, scoreThreshold, config);
  log(`  - 第0轮检索到 ${round0Results.length} 篇文章`);
  
  round0Results.forEach((c) => {
    if (c.articleId !== null) {
      allCandidateIds.add(c.articleId);
    }
  });

  let candidates = round0Results;
  let currentRoundResults = round0Results;

  for (let round = 1; round <= rounds; round++) {
    log(`[迭代 ${round}/${rounds}] 对第${round - 1}轮结果进行检索...`);

    try {
      const nextRoundCandidates: CandidateArticle[] = [];
      
      for (const prevCandidate of currentRoundResults) {
        let seedArticle: SeedArticle[] = [];
        
        if (prevCandidate.articleId !== null) {
          const article = await getArticleById(prevCandidate.articleId);
          if (article) {
            seedArticle = [{
              articleId: article.id,
              title: article.title,
              aiSummary: article.ai_summary,
              markdownContent: article.markdown_content,
              content: article.content,
            }];
          }
        }
        
        if (seedArticle.length > 0) {
          const searchResults = await performSearchRound(seedArticle, semanticLimit, scoreThreshold, config);
          nextRoundCandidates.push(...searchResults);
        }
      }

      const merged = mergeResults([], nextRoundCandidates);
      const filtered = filterByScore(merged, scoreThreshold);
      
      log(`  - 第${round}轮检索到 ${filtered.length} 篇新文章`);

      filtered.forEach((c) => {
        if (c.articleId !== null && !allCandidateIds.has(c.articleId)) {
          allCandidateIds.add(c.articleId);
          candidates.push(c);
        }
      });

      currentRoundResults = filtered;

      if (currentRoundResults.length === 0) {
        log('  - 没有新的相关文章，停止迭代');
        break;
      }
    } catch (error) {
      console.error(`迭代 ${round} 失败:`, error);
      onLog?.(`迭代 ${round} 失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return candidates;
}

async function performSearchRound(
  seedArticles: SeedArticle[],
  semanticLimit: number,
  scoreThreshold: number,
  config: ReturnType<typeof getConfig>
): Promise<CandidateArticle[]> {
  const relatedFromIds = await searchRelatedByIds(seedArticles, semanticLimit);

  let searchResults: CandidateArticle[] = [];
  try {
    const llm = await getUserLLMProvider(config.llm.task_type ?? undefined);
    const searchTerms = await generateSearchTerms(seedArticles, llm, config);

    for (const term of searchTerms.slice(0, 3)) {
      const semanticResults = await semanticSearch(term, semanticLimit);
      searchResults.push(...semanticResults);
    }
  } catch (error) {
    console.error(`  - 检索词生成或语义检索失败:`, error);
  }

  const merged = mergeResults(relatedFromIds, searchResults);
  const filtered = filterByScore(merged, scoreThreshold);

  return filtered;
}

async function processPdfSummary(
  candidates: CandidateArticle[],
  onLog?: (message: string) => void
): Promise<{ success: number; failed: number; skipped: number }> {
  let success = 0;
  let failed = 0;
  let skipped = 0;
  const log = (message: string): void => {
    console.log(message);
    onLog?.(message);
  };

  for (const candidate of candidates) {
    log(`[PDF 总结] ${candidate.title}...`);

    try {
      let pdfResult = null;
      let isSkipped = false;
      let content = '';

      if (candidate.articleId !== null) {
        let article = await getArticleById(candidate.articleId);

        if (article?.ai_summary) {
          log('  - 已有摘要，跳过 PDF 总结');
          skipped++;
          isSkipped = true;
          content = article.ai_summary || article.markdown_content || article.content || '';
        } else {
          pdfResult = await callPdfApiWithRetry(candidate.title, candidate.articleId);
          if (pdfResult.success) {
            success++;
            log('  - PDF 总结成功');
            article = await getArticleById(candidate.articleId);
            content = article?.ai_summary || article?.markdown_content || article?.content || '';
          } else {
            failed++;
            log(`  - PDF 总结失败: ${pdfResult.reason}`);
            content = article?.markdown_content || article?.content || '';
          }
        }

        const mdContent = await generateArticleSummaryMD(
          candidate.articleId,
          candidate.title,
          content,
          pdfResult?.success ?? false,
          pdfResult?.reason,
          isSkipped
        );
        await saveArticleMD(candidate.articleId, candidate.title, mdContent);
      } else {
        pdfResult = await callPdfApiWithRetry(candidate.title, null);
        if (pdfResult.success) {
          success++;
          log('  - PDF 总结成功');
        } else {
          failed++;
          log(`  - PDF 总结失败: ${pdfResult.reason}`);
        }

        const mdContent = await generateArticleSummaryMD(
          null,
          candidate.title,
          pdfResult.md_path ? `PDF 原文路径: ${pdfResult.pdf_path}` : '',
          pdfResult.success,
          pdfResult.reason,
          false
        );
        await saveArticleMD(null, candidate.title, mdContent);
      }
    } catch (error) {
      failed++;
      console.error(`  - PDF 总结异常:`, error);
      onLog?.(`  - PDF 总结异常: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { success, failed, skipped };
}

export interface DeepSearchOptions {
  inputMd: string;
  rounds?: number;
  scoreThreshold?: number;
  semanticLimit?: number;
  maxFinalArticles?: number;
  outputDir?: string;
  configPath?: string;
  onProgress?: (step: string, current: number, total: number) => void;
  onLog?: (message: string) => void;
}

export async function runDeepSearch(options: DeepSearchOptions): Promise<DeepSearchResult> {
  const totalProgress = 100;
  const emitProgress = (step: string, current: number): void => {
    options.onProgress?.(step, current, totalProgress);
  };
  const emitLog = (message: string): void => {
    options.onLog?.(message);
  };

  if (options.configPath) {
    loadConfig(options.configPath);
  }

  const config = getConfig();
  configureOutputDir(options.outputDir);
  ensureOutputDir();

  console.log('='.repeat(50));
  console.log('DeepSearch 开始执行');
  console.log('='.repeat(50));
  emitLog('DeepSearch 开始执行');
  emitProgress('searching', 5);

  await writeStepReport('步骤一：检索相关文章', '开始解析输入文件...');
  emitLog('步骤一：开始解析输入文件');
  emitProgress('searching', 10);

  const seedArticles = await parseSeedFileToArticles(options.inputMd);
  console.log(`解析到 ${seedArticles.length} 个种子文章`);
  emitLog(`步骤一：解析到 ${seedArticles.length} 个种子文章`);

  const report = `解析到 ${seedArticles.length} 个种子文章:\n${seedArticles.map((a) => `- ${a.title}${a.articleId ? ` (ID: ${a.articleId})` : ''}`).join('\n')}`;
  await writeStepReport('步骤一：检索相关文章', report);

  const rounds = options.rounds ?? config.search.iteration_rounds;
  const threshold = options.scoreThreshold ?? config.search.score_threshold;
  const limit = options.semanticLimit ?? config.search.semantic_limit;
  const maxFinal = options.maxFinalArticles ?? config.search.max_final_articles;

  console.log(`\n开始迭代检索 (轮次: ${rounds}, 阈值: ${threshold}, 限制: ${limit})`);
  await writeStepReport('步骤一：检索相关文章', `迭代检索参数: 轮次=${rounds}, 阈值=${threshold}, 限制=${limit}`);
  emitLog(`步骤一：开始迭代检索，轮次=${rounds}，阈值=${threshold}，限制=${limit}`);
  emitProgress('searching', 20);

  let candidates = await iterativeSearch(seedArticles, rounds, threshold, limit, emitLog);
  emitProgress('searching', 60);

  if (maxFinal > 0) {
    candidates.sort((a, b) => b.score - a.score);
    candidates = candidates.slice(0, maxFinal);
  }

  console.log(`\n检索完成，找到 ${candidates.length} 篇候选文章`);
  emitLog(`步骤一：检索完成，找到 ${candidates.length} 篇候选文章`);
  const candidateList = candidates.map((c) => `- ${c.title} (得分: ${c.score.toFixed(2)}, 来源: ${c.source})`).join('\n');
  await writeStepReport('步骤一：检索相关文章', `找到 ${candidates.length} 篇候选文章:\n${candidateList}`);

  await writeStepReport('步骤二：PDF 总结', `开始处理 ${candidates.length} 篇文章的 PDF 总结...`);
  emitLog(`步骤二：开始处理 ${candidates.length} 篇文章的 PDF 总结`);
  emitProgress('pdf_summary', 70);

  const pdfResult = await processPdfSummary(candidates, emitLog);
  emitProgress('pdf_summary', 95);

  console.log(`\nPDF 总结完成: 成功 ${pdfResult.success}, 失败 ${pdfResult.failed}, 跳过 ${pdfResult.skipped}`);
  emitLog(`步骤二：PDF 总结完成，成功 ${pdfResult.success}，失败 ${pdfResult.failed}，跳过 ${pdfResult.skipped}`);
  await writeStepReport(
    '步骤二：PDF 总结',
    `PDF 总结完成:\n- 成功: ${pdfResult.success}\n- 失败: ${pdfResult.failed}\n- 跳过: ${pdfResult.skipped}`
  );

  console.log('='.repeat(50));
  console.log('DeepSearch 执行完成');
  console.log('='.repeat(50));
  emitLog('DeepSearch 执行完成');
  emitProgress('completed', 100);

  return {
    reportPath: getReportPath(),
    articlesDir: getArticlesDir(),
    outputDir: getOutputDir(),
    articleCount: candidates.length,
    pdfSummarySuccess: pdfResult.success,
    pdfSummaryFailed: pdfResult.failed,
    pdfSummarySkipped: pdfResult.skipped,
  };
}
