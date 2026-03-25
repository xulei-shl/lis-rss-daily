import { getConfig, loadConfig } from './config.js';
import { getArticleById } from './database.js';
import { getUserLLMProvider, type LLMProvider, type ChatMessage } from './llm.js';
import { semanticSearch, relatedSearch, filterByScore } from './search.js';
import { callPdfApiWithRetry } from './pdf-api.js';
import { configureOutputDir, ensureOutputDir, writeStepReport, saveArticleMD, generateArticleSummaryMD, getReportPath, getArticlesDir, getOutputDir } from './report.js';
import { parseSeedFileToArticles } from './md-parser.js';
import type { SeedArticle, CandidateArticle, DeepSearchResult, PdfApiResult } from './types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROMPTS_DIR = path.join(__dirname, 'prompts');

interface SearchRoundMetrics {
  relatedArticlesCount: number;
  semanticSearchTermsCount: number;
  semanticSearchHitsCount: number;
}

interface IterativeSearchStats extends SearchRoundMetrics {
  iterationRoundsExecuted: number;
}

interface RelatedSearchResult {
  candidates: CandidateArticle[];
  metrics: SearchRoundMetrics;
  iterationRoundsExecuted: number;
}

function createEmptySearchMetrics(): SearchRoundMetrics {
  return {
    relatedArticlesCount: 0,
    semanticSearchTermsCount: 0,
    semanticSearchHitsCount: 0,
  };
}

function accumulateSearchMetrics(target: SearchRoundMetrics, source: SearchRoundMetrics): void {
  target.relatedArticlesCount += source.relatedArticlesCount;
  target.semanticSearchTermsCount += source.semanticSearchTermsCount;
  target.semanticSearchHitsCount += source.semanticSearchHitsCount;
}

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

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getCandidateKey(candidate: CandidateArticle): string {
  if (candidate.articleId !== null) {
    return `id:${candidate.articleId}`;
  }
  return `title:${normalizeTitle(candidate.title)}`;
}

function upsertCandidate(map: Map<string, CandidateArticle>, candidate: CandidateArticle): void {
  const key = getCandidateKey(candidate);
  const existing = map.get(key);

  if (!existing) {
    map.set(key, { ...candidate });
    return;
  }

  if (candidate.score > existing.score) {
    existing.score = candidate.score;
    existing.title = candidate.title;
    existing.articleId = candidate.articleId;
  }

  if (candidate.articleId !== null && existing.articleId === null) {
    existing.articleId = candidate.articleId;
    const byIdKey = getCandidateKey(existing);
    if (byIdKey !== key) {
      map.delete(key);
      map.set(byIdKey, existing);
    }
  }

  if (candidate.source === 'seed') {
    existing.source = 'seed';
  } else if (candidate.source === 'semantic' && existing.source === 'related') {
    existing.source = 'semantic';
  }
}

function mergeAndSortCandidates(candidates: CandidateArticle[]): CandidateArticle[] {
  const map = new Map<string, CandidateArticle>();
  for (const candidate of candidates) {
    upsertCandidate(map, candidate);
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score);
}

function toSeedCandidate(seed: SeedArticle): CandidateArticle {
  return {
    articleId: seed.articleId,
    title: seed.title,
    score: 1,
    source: 'seed',
  };
}

async function generateSearchTerms(
  article: SeedArticle,
  llm: LLMProvider,
  config: ReturnType<typeof getConfig>
): Promise<string[]> {
  const promptTemplate = loadPromptTemplate(config.search.prompt);
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
      const terms = parsed.search_queries
        .map((term: unknown) => (typeof term === 'string' ? term.trim() : ''))
        .filter((term: string) => term.length > 0);
      return Array.from(new Set<string>(terms));
    }
  } catch (error) {
    console.error(`生成检索词失败: ${article.title}`, error);
  }

  return [];
}

async function searchRelatedBySeed(
  seedArticle: SeedArticle,
  rounds: number,
  limit: number,
  scoreThreshold: number,
  onLog?: (message: string) => void
): Promise<RelatedSearchResult> {
  const metrics = createEmptySearchMetrics();
  const allCandidatesMap = new Map<string, CandidateArticle>();
  const queriedIds = new Set<number>();
  let frontierIds: number[] = seedArticle.articleId !== null ? [seedArticle.articleId] : [];
  let iterationRoundsExecuted = 0;

  const log = (message: string): void => {
    console.log(message);
    onLog?.(message);
  };

  for (let round = 0; round <= rounds; round += 1) {
    if (frontierIds.length === 0) {
      break;
    }

    const nextFrontier = new Set<number>();
    let queriedInThisRound = false;
    let roundHits = 0;
    let roundAdded = 0;

    for (const articleId of frontierIds) {
      if (queriedIds.has(articleId)) {
        continue;
      }
      queriedIds.add(articleId);
      queriedInThisRound = true;

      const related = await relatedSearch(articleId, limit);
      metrics.relatedArticlesCount += related.length;
      roundHits += related.length;

      const filtered = filterByScore(related, scoreThreshold);
      for (const candidate of filtered) {
        if (candidate.articleId !== null && !queriedIds.has(candidate.articleId)) {
          nextFrontier.add(candidate.articleId);
        }

        const beforeSize = allCandidatesMap.size;
        upsertCandidate(allCandidatesMap, candidate);
        if (allCandidatesMap.size !== beforeSize) {
          roundAdded += 1;
        }
      }
    }

    if (queriedInThisRound) {
      iterationRoundsExecuted += 1;
    }

    log(`  - ID检索第${round}轮：命中 ${roundHits}，新增 ${roundAdded}`);
    frontierIds = Array.from(nextFrontier);
  }

  return {
    candidates: Array.from(allCandidatesMap.values()),
    metrics,
    iterationRoundsExecuted,
  };
}

async function searchSemanticBySeed(
  seedArticle: SeedArticle,
  llm: LLMProvider,
  semanticLimit: number,
  scoreThreshold: number,
  config: ReturnType<typeof getConfig>,
  onLog?: (message: string) => void
): Promise<{ candidates: CandidateArticle[]; metrics: SearchRoundMetrics }> {
  const metrics = createEmptySearchMetrics();
  const allCandidatesMap = new Map<string, CandidateArticle>();

  const searchTerms = await generateSearchTerms(seedArticle, llm, config);
  metrics.semanticSearchTermsCount = searchTerms.length;
  onLog?.(`  - 语义检索词数量: ${searchTerms.length}`);

  for (const term of searchTerms) {
    const semanticResults = await semanticSearch(term, semanticLimit);
    metrics.semanticSearchHitsCount += semanticResults.length;

    const filtered = filterByScore(semanticResults, scoreThreshold);
    for (const candidate of filtered) {
      upsertCandidate(allCandidatesMap, candidate);
    }
  }

  return {
    candidates: Array.from(allCandidatesMap.values()),
    metrics,
  };
}

async function iterativeSearch(
  seedArticles: SeedArticle[],
  rounds: number,
  scoreThreshold: number,
  semanticLimit: number,
  onLog?: (message: string) => void
): Promise<{ candidates: CandidateArticle[]; stats: IterativeSearchStats }> {
  const config = getConfig();
  const llm = await getUserLLMProvider(config.llm.task_type ?? undefined);
  const totalMetrics = createEmptySearchMetrics();
  let iterationRoundsExecuted = 0;
  const globalCandidatesMap = new Map<string, CandidateArticle>();

  const log = (message: string): void => {
    console.log(message);
    onLog?.(message);
  };

  for (let index = 0; index < seedArticles.length; index += 1) {
    const seed = seedArticles[index];
    log(`[种子 ${index + 1}/${seedArticles.length}] ${seed.title}${seed.articleId !== null ? ` (ID: ${seed.articleId})` : ''}`);

    const relatedResult = await searchRelatedBySeed(seed, rounds, semanticLimit, scoreThreshold, onLog);
    const semanticResult = await searchSemanticBySeed(seed, llm, semanticLimit, scoreThreshold, config, onLog);
    iterationRoundsExecuted += relatedResult.iterationRoundsExecuted;
    accumulateSearchMetrics(totalMetrics, relatedResult.metrics);
    accumulateSearchMetrics(totalMetrics, semanticResult.metrics);

    const perSeedMerged = mergeAndSortCandidates([
      ...relatedResult.candidates,
      ...semanticResult.candidates,
    ]);
    log(`  - 种子结果合并后 ${perSeedMerged.length} 篇`);

    for (const candidate of perSeedMerged) {
      upsertCandidate(globalCandidatesMap, candidate);
    }
  }

  const candidates = Array.from(globalCandidatesMap.values()).sort((a, b) => b.score - a.score);

  return {
    candidates,
    stats: {
      ...totalMetrics,
      iterationRoundsExecuted,
    },
  };
}

function loadPdfSummaryContent(pdfResult: PdfApiResult | null): string {
  if (!pdfResult?.success) {
    return '';
  }

  if (pdfResult.md_path) {
    try {
      if (fs.existsSync(pdfResult.md_path)) {
        return fs.readFileSync(pdfResult.md_path, 'utf8');
      }
      return `PDF 总结文件: ${pdfResult.md_path}`;
    } catch (error) {
      console.warn(`读取 PDF 总结文件失败: ${pdfResult.md_path}`, error);
      return `PDF 总结文件: ${pdfResult.md_path}`;
    }
  }

  if (pdfResult.pdf_path) {
    return `PDF 原文路径: ${pdfResult.pdf_path}`;
  }

  return '';
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
      let pdfResult: PdfApiResult | null = null;
      let isSkipped = false;
      let content = '';

      if (candidate.articleId !== null) {
        let article = await getArticleById(candidate.articleId);

        if (article?.ai_summary) {
          log('  - 已有摘要，跳过 PDF 总结');
          skipped += 1;
          isSkipped = true;
          content = article.ai_summary || article.markdown_content || article.content || '';
        } else {
          pdfResult = await callPdfApiWithRetry(candidate.title, candidate.articleId);
          if (pdfResult.success) {
            success += 1;
            log('  - PDF 总结成功');
            article = await getArticleById(candidate.articleId);
            content = article?.ai_summary || article?.markdown_content || article?.content || '';
            if (!content) {
              content = loadPdfSummaryContent(pdfResult);
            }
          } else {
            failed += 1;
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
          success += 1;
          log('  - PDF 总结成功');
          content = loadPdfSummaryContent(pdfResult);
        } else {
          failed += 1;
          log(`  - PDF 总结失败: ${pdfResult.reason}`);
          content = '';
        }

        const mdContent = await generateArticleSummaryMD(
          null,
          candidate.title,
          content,
          pdfResult.success,
          pdfResult.reason,
          false
        );
        await saveArticleMD(null, candidate.title, mdContent);
      }
    } catch (error) {
      failed += 1;
      console.error('  - PDF 总结异常:', error);
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

  const seedReport = `解析到 ${seedArticles.length} 个种子文章:\n${seedArticles.map((a) => `- ${a.title}${a.articleId ? ` (ID: ${a.articleId})` : ''}`).join('\n')}`;
  await writeStepReport('步骤一：检索相关文章', seedReport);

  const rounds = options.rounds ?? config.search.iteration_rounds;
  const threshold = options.scoreThreshold ?? config.search.score_threshold;
  const limit = options.semanticLimit ?? config.search.semantic_limit;
  const maxFinal = options.maxFinalArticles ?? config.search.max_final_articles;

  console.log(`\n开始检索 (轮次: ${rounds}, 阈值: ${threshold}, 限制: ${limit})`);
  await writeStepReport('步骤一：检索相关文章', `检索参数: 轮次=${rounds}, 阈值=${threshold}, 限制=${limit}`);
  emitLog(`步骤一：开始检索，轮次=${rounds}，阈值=${threshold}，限制=${limit}`);
  emitProgress('searching', 20);

  const iterativeResult = await iterativeSearch(seedArticles, rounds, threshold, limit, emitLog);
  let candidates = iterativeResult.candidates;
  const searchStats = {
    seedArticleCount: seedArticles.length,
    relatedArticlesCount: iterativeResult.stats.relatedArticlesCount,
    semanticSearchTermsCount: iterativeResult.stats.semanticSearchTermsCount,
    semanticSearchHitsCount: iterativeResult.stats.semanticSearchHitsCount,
    iterationRoundsConfigured: rounds,
    iterationRoundsExecuted: iterativeResult.stats.iterationRoundsExecuted,
  };
  emitProgress('searching', 60);

  if (maxFinal > 0) {
    candidates = candidates.slice(0, maxFinal);
  }

  const candidatesForPdf = mergeAndSortCandidates([
    ...candidates,
    ...seedArticles.map(toSeedCandidate),
  ]);

  console.log(`\n检索完成，候选 ${candidates.length} 篇，PDF处理集合 ${candidatesForPdf.length} 篇（含种子）`);
  emitLog(`步骤一：检索完成，候选 ${candidates.length} 篇，PDF处理集合 ${candidatesForPdf.length} 篇（含种子）`);
  emitLog(
    `步骤一统计：相关文章 ${searchStats.relatedArticlesCount}，语义检索词 ${searchStats.semanticSearchTermsCount}，语义命中 ${searchStats.semanticSearchHitsCount}`
  );
  const candidateList = candidates.map((c) => `- ${c.title} (得分: ${c.score.toFixed(2)}, 来源: ${c.source})`).join('\n');
  await writeStepReport(
    '步骤一：检索相关文章',
    `找到 ${candidates.length} 篇候选文章（max_final_articles 后）:\n${candidateList || '(无)'}\n\nPDF处理集合（含种子）共 ${candidatesForPdf.length} 篇`
  );

  await writeStepReport('步骤二：PDF 总结', `开始处理 ${candidatesForPdf.length} 篇文章的 PDF 总结（含种子）...`);
  emitLog(`步骤二：开始处理 ${candidatesForPdf.length} 篇文章的 PDF 总结（含种子）`);
  emitProgress('pdf_summary', 70);

  const pdfResult = await processPdfSummary(candidatesForPdf, emitLog);
  emitProgress('pdf_summary', 95);

  console.log(`\nPDF 总结完成: 成功 ${pdfResult.success}, 失败 ${pdfResult.failed}, 跳过 ${pdfResult.skipped}`);
  emitLog(`步骤二：PDF 总结完成，成功 ${pdfResult.success}，失败 ${pdfResult.failed}，跳过 ${pdfResult.skipped}`);
  await writeStepReport(
    '步骤二：PDF 总结',
    `PDF 总结完成:\n- 处理总数: ${candidatesForPdf.length}\n- 成功: ${pdfResult.success}\n- 失败: ${pdfResult.failed}\n- 跳过: ${pdfResult.skipped}`
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
    articleCount: candidatesForPdf.length,
    pdfSummarySuccess: pdfResult.success,
    pdfSummaryFailed: pdfResult.failed,
    pdfSummarySkipped: pdfResult.skipped,
    searchStats,
  };
}
