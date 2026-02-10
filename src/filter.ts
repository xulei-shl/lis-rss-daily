/**
 * Article Filter Module - LLM Filtering
 *
 * Implements a single-stage filtering strategy:
 * 1. LLM precise filter (JSON mode)
 *
 * All filter decisions are logged to article_filter_logs table.
 */

import { getDb } from './db.js';
import { getUserLLMProvider, type ChatMessage } from './llm.js';
import { logger } from './logger.js';
import { resolveSystemPrompt } from './api/system-prompts.js';
import { parseLLMJSON } from './utils/llm-json-parser.js';
import { buildPromptVariables, type ArticleContext } from './api/prompt-variable-builder.js';
import { type SourceType } from './constants/source-types.js';

const log = logger.child({ module: 'article-filter' });

/* ── Public Types ── */

/**
 * Input for article filtering
 */
export interface FilterInput {
  articleId: number;
  userId: number;
  title: string;
  url?: string;
  description: string;
  content?: string;
  sourceType?: SourceType;
}

/**
 * Result of article filtering
 */
export interface FilterResult {
  passed: boolean;
  relevanceScore?: number;
  domainMatches: DomainMatchResult[];
  filterReason?: string;
  usedFallback: boolean;
}

/**
 * Result for a single domain
 */
export interface DomainMatchResult {
  domainId: number;
  domainName: string;
  passed: boolean;
  relevanceScore?: number;
  reasoning?: string;
}

/**
 * Filter options
 */
export interface FilterOptions {
  /** 通过的最低相关度分数（默认 0.6） */
  minRelevanceScore?: number;
}

/**
 * LLM response format (standard evaluations array)
 */
interface LLMEvaluation {
  domain_id: number;
  is_relevant: boolean;
  relevance_score: number;
  reasoning: string;
}

interface LLMResponse {
  evaluations: LLMEvaluation[];
}

/**
 * Alternative LLM response format (decision-based)
 * Some custom prompts may return this format
 */
interface AlternativeLLMResponse {
  decision: '通过' | '拒绝' | 'pass' | 'reject' | boolean;
  reasoning?: string;
  matched_domains?: Array<{
    domain_id: number;
    relevance_score?: number;
    reasoning?: string;
  }>;
}

/* ── Internal Types ── */

/* ── LLM Precise Filter ── */

/**
 * Stage 2: LLM-based precise filtering
 */
async function llmFilter(
  input: FilterInput
): Promise<{
  results: Map<number, Omit<DomainMatchResult, 'domainName'>>;
  domainNames: Map<number, string>;
  error?: string;
  rawResponse?: string;
}> {
  // Import here to avoid circular dependency
  const { getActiveTopicDomains } = await import('./api/topic-domains.js');

  // Get active domains for result mapping
  const activeDomains = await getActiveTopicDomains(input.userId);
  const domainNames = new Map<number, string>(activeDomains.map((d) => [d.id, d.name]));
  if (activeDomains.length === 0) {
    return { results: new Map(), domainNames };
  }

  // Build variables using the unified builder
  const articleContext: ArticleContext = {
    articleId: input.articleId,
    userId: input.userId,
    title: input.title,
    url: input.url,
    description: input.description,
    content: input.content,
    sourceType: input.sourceType,
  };
  const variables = await buildPromptVariables({ type: 'filter', article: articleContext });

  // Get system prompt from database (no fallback - must be configured)
  const systemPrompt = await resolveSystemPrompt(input.userId, 'filter', '', variables);

  if (!systemPrompt || systemPrompt.trim().length === 0) {
    return {
      results: new Map(),
      domainNames,
      error: '未配置 filter 类型的系统提示词，请在系统提示词管理中添加',
    };
  }

  const userPrompt = `请评估以下文章：

# 文章信息
题目: ${input.title}
摘要: ${input.description}
${input.content ? `内容预览: ${input.content.substring(0, 2000)}...` : ''}

请严格按照指定的 JSON 格式返回评估结果。`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const llm = await getUserLLMProvider(input.userId, 'filter');
    const response = await llm.chat(messages, {
      jsonMode: true,
      temperature: 0.3,
      label: 'article-filter',
    });

    // 使用新的JSON解析工具
    const parseResult = parseLLMJSON<LLMResponse | AlternativeLLMResponse>(response, {
      allowPartial: true,
      maxResponseLength: 2048,
      errorPrefix: 'Filter evaluation',
    });

    if (!parseResult.success) {
      log.warn(
        { error: parseResult.error, articleId: input.articleId, rawResponse: response },
        'LLM JSON parse failed'
      );
      return { results: new Map(), error: parseResult.error, rawResponse: response, domainNames };
    }

    const parsed = parseResult.data!;
    const results = new Map<number, Omit<DomainMatchResult, 'domainName'>>();

    // 检测响应格式并转换为统一格式
    if ('evaluations' in parsed && Array.isArray(parsed.evaluations)) {
      // 标准格式：evaluations 数组
      for (const evaluation of parsed.evaluations) {
        results.set(evaluation.domain_id, {
          domainId: evaluation.domain_id,
          passed: evaluation.is_relevant,
          relevanceScore: evaluation.relevance_score,
          reasoning: evaluation.reasoning,
        });
      }
    } else if ('matched_domains' in parsed && Array.isArray(parsed.matched_domains)) {
      // 备选格式：decision + matched_domains（兼容旧版自定义 prompt）
      const decision = parsed.decision;
      const isPassed = typeof decision === 'boolean' ? decision : decision === '通过' || decision === 'pass';
      for (const match of parsed.matched_domains) {
        results.set(match.domain_id, {
          domainId: match.domain_id,
          passed: isPassed,
          relevanceScore: match.relevance_score ?? (isPassed ? 0.8 : 0),
          reasoning: match.reasoning ?? parsed.reasoning ?? '',
        });
      }
    } else {
      log.warn({ parsed, rawResponse: response }, 'Unknown LLM response format');
      return { results: new Map(), error: '未知的 LLM 响应格式', rawResponse: response, domainNames };
    }

    log.debug(
      { articleId: input.articleId, evaluationCount: results.size, usedPartialParse: parseResult.usedPartialParse },
      'LLM filter completed'
    );

    return { results, rawResponse: response, domainNames };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn({ error: errorMessage, articleId: input.articleId }, 'LLM filter failed');
    return { results: new Map(), error: errorMessage, domainNames };
  }
}

/* ── Filter Log Recording ── */

/**
 * Record filter decision to database
 */
async function recordFilterLog(
  articleId: number,
  domainId: number | null,
  isPassed: boolean,
  relevanceScore: number | null,
  filterReason: string | null,
  llmResponse: string | null = null
): Promise<void> {
  const db = getDb();

  await db
    .insertInto('article_filter_logs')
    .values({
      article_id: articleId,
      domain_id: domainId,
      is_passed: isPassed ? 1 : 0,
      relevance_score: relevanceScore,
      matched_keywords: null,
      filter_reason: filterReason,
      llm_response: llmResponse,
      created_at: new Date().toISOString(),
    } as any)
    .execute();
}

/**
 * Record all filter results to database
 */
async function recordFilterResults(
  input: FilterInput,
  domainMatches: DomainMatchResult[],
  options: {
    llmResponse?: string | null;
    overallPassed: boolean;
    fallbackReason?: string;
  }
): Promise<void> {
  // Record each domain evaluation
  for (const match of domainMatches) {
    await recordFilterLog(
      input.articleId,
      match.domainId,
      match.passed,
      match.relevanceScore ?? null,
      match.reasoning ?? null,
      null // Individual domain logs don't need full LLM response
    );
  }

  const hasDomainLog = domainMatches.length > 0;
  if (!hasDomainLog) {
    const llmResponse = options.llmResponse ?? null;
    const reason = options.fallbackReason || '无领域评估结果';
    await recordFilterLog(
      input.articleId,
      null,
      options.overallPassed,
      null,
      reason,
      llmResponse
    );
  }
}

/* ── Main Filter Function ── */

/**
 * Filter an article using LLM filtering
 * @param input - Article data to filter
 * @param options - Filter options
 * @returns Filter result
 */
export async function filterArticle(
  input: FilterInput,
  options: FilterOptions = {}
): Promise<FilterResult> {
  const minScore = options.minRelevanceScore ?? 0.6;
  const requestLog = log.child({ articleId: input.articleId, userId: input.userId });

  requestLog.debug({ title: input.title }, 'Starting article filter');

  // LLM filter
  const llmResult = await llmFilter(input);

  if (llmResult.error) {
    requestLog.warn({ error: llmResult.error }, 'LLM filter failed');
    await updateArticleFilterStatus(input.articleId, 'rejected', 0);
    await recordFilterLog(
      input.articleId,
      null,
      false,
      null,
      `LLM failed: ${llmResult.error}`,
      llmResult.rawResponse ?? null
    );
    return {
      passed: false,
      domainMatches: [],
      filterReason: `LLM failed: ${llmResult.error}`,
      usedFallback: false,
    };
  }

  if (llmResult.results.size === 0) {
    const reason = 'LLM 未返回有效评估结果';
    await updateArticleFilterStatus(input.articleId, 'rejected', 0);
    await recordFilterLog(
      input.articleId,
      null,
      false,
      null,
      reason,
      llmResult.rawResponse ?? null
    );
    return {
      passed: false,
      domainMatches: [],
      filterReason: reason,
      usedFallback: false,
    };
  }

  // Process LLM results
  const domainMatches: DomainMatchResult[] = [];
  const domainNames = llmResult.domainNames;

  for (const [domainId, result] of Array.from(llmResult.results.entries())) {
    const domainName = domainNames.get(domainId) || '';
    const matchResult: DomainMatchResult = {
      ...result,
      domainName,
    };
    domainMatches.push(matchResult);
  }

  // Determine overall pass/fail
  const passedMatches = domainMatches.filter((m) => m.passed && (m.relevanceScore ?? 0) >= minScore);
  const passed = passedMatches.length > 0;
  const relevanceScore = passed ? Math.max(...passedMatches.map((m) => m.relevanceScore ?? 0)) : 0;

  // Auto-update filter_status
  await updateArticleFilterStatus(input.articleId, passed ? 'passed' : 'rejected', relevanceScore);

  await recordFilterResults(input, domainMatches, {
    llmResponse: llmResult.rawResponse ?? null,
    overallPassed: passed,
    fallbackReason: passed ? 'Passed LLM evaluation' : 'Failed LLM relevance threshold',
  });

  requestLog.info(
    {
      passed,
      domainCount: domainMatches.length,
      passedCount: passedMatches.length,
      maxScore: relevanceScore,
    },
    'Filter completed'
  );

  return {
    passed,
    relevanceScore: passed ? relevanceScore : undefined,
    domainMatches,
    filterReason: passed ? 'Passed LLM evaluation' : 'Failed LLM relevance threshold',
    usedFallback: false,
  };
}

/**
 * Update article filter status in database
 * @param articleId - Article ID
 * @param status - Filter status ('passed' or 'rejected')
 * @param score - Relevance score
 */
async function updateArticleFilterStatus(
  articleId: number,
  status: 'passed' | 'rejected',
  score: number
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  // Rejected articles don't need processing, mark as completed
  const processStatus = status === 'rejected' ? 'completed' : undefined;

  await db
    .updateTable('articles')
    .set({
      filter_status: status,
      filter_score: score,
      filtered_at: now,
      ...(processStatus && { process_status: processStatus }),
      updated_at: now,
    })
    .where('id', '=', articleId)
    .where('filter_status', '=', 'pending')  // Only update if still pending
    .execute();

  log.debug({ articleId, status, score, processStatus }, 'Article filter status updated');
}

/**
 * Batch filter multiple articles
 * @param inputs - Array of article data to filter
 * @param options - Filter options
 * @returns Array of filter results
 */
export async function filterArticles(
  inputs: FilterInput[],
  options: FilterOptions = {}
): Promise<FilterResult[]> {
  const results: FilterResult[] = [];

  for (const input of inputs) {
    const result = await filterArticle(input, options);
    results.push(result);
  }

  return results;
}

/* ── Statistics Functions ── */

/**
 * Get filter statistics for a user
 */
export async function getFilterStats(userId: number): Promise<{
  totalFiltered: number;
  totalPassed: number;
  totalRejected: number;
  passRate: number;
  avgRelevanceScore: number;
  byDomain: Array<{
    domainId: number;
    domainName: string;
    totalFiltered: number;
    totalPassed: number;
    passRate: number;
    avgScore: number;
  }>;
}> {
  const db = getDb();

  // Get overall stats
  const overallStats = await db
    .selectFrom('article_filter_logs')
    .innerJoin('articles', 'articles.id', 'article_filter_logs.article_id')
    .innerJoin('rss_sources', 'rss_sources.id', 'articles.rss_source_id')
    .where('rss_sources.user_id', '=', userId)
    .select((eb) => [
      eb.fn.count('article_filter_logs.id').as('total'),
      eb.fn.sum(eb.case().when('article_filter_logs.is_passed', '=', 1).then(1).else(0) as any).as('passed'),
      eb.fn.avg('article_filter_logs.relevance_score').as('avg_score'),
    ])
    .executeTakeFirst();

  const total = Number(overallStats?.total ?? 0);
  const passed = Number(overallStats?.passed ?? 0);
  const avgScore = Number(overallStats?.avg_score ?? 0);

  // Get stats by domain
  const byDomainResult = await db
    .selectFrom('article_filter_logs')
    .innerJoin('topic_domains', 'topic_domains.id', 'article_filter_logs.domain_id')
    .where('article_filter_logs.domain_id', 'is not', null)
    .select((eb) => [
      'topic_domains.id as domainId',
      'topic_domains.name as domainName',
      eb.fn.count('article_filter_logs.id').as('total'),
      eb.fn.sum(eb.case().when('article_filter_logs.is_passed', '=', 1).then(1).else(0) as any).as('passed'),
      eb.fn.avg('article_filter_logs.relevance_score').as('avg_score'),
    ])
    .groupBy('topic_domains.id')
    .orderBy('passed', 'desc')
    .execute();

  const byDomain = byDomainResult.map((row) => ({
    domainId: Number(row.domainId),
    domainName: row.domainName,
    totalFiltered: Number(row.total),
    totalPassed: Number(row.passed),
    passRate: Number(row.total) > 0 ? Number(row.passed) / Number(row.total) : 0,
    avgScore: Number(row.avg_score ?? 0),
  }));

  return {
    totalFiltered: total,
    totalPassed: passed,
    totalRejected: total - passed,
    passRate: total > 0 ? passed / total : 0,
    avgRelevanceScore: avgScore,
    byDomain,
  };
}
