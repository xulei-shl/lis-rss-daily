/**
 * Article Filter Module - Two-Stage Filtering
 *
 * Implements a two-stage filtering strategy:
 * 1. Keyword pre-filter (quick rejection)
 * 2. LLM precise filter (JSON mode)
 * 3. Keyword-only fallback when LLM fails
 *
 * All filter decisions are logged to article_filter_logs table.
 */

import { getDb } from './db.js';
import { getUserLLMProvider, getLLM, type ChatMessage } from './llm.js';
import { logger } from './logger.js';
import { getActiveTopicDomains } from './api/topic-domains.js';
import { getActiveKeywordsForDomain } from './api/topic-keywords.js';

const log = logger.child({ module: 'article-filter' });

/* ── Public Types ── */

/**
 * Input for article filtering
 */
export interface FilterInput {
  articleId: number;
  userId: number;
  title: string;
  description: string;
  content?: string;
}

/**
 * Result of article filtering
 */
export interface FilterResult {
  passed: boolean;
  relevanceScore?: number;
  matchedKeywords?: string[];
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
  matchedKeywords?: string[];
  reasoning?: string;
}

/**
 * Filter options
 */
export interface FilterOptions {
  /** Force keyword-only mode (skip LLM) */
  skipLLM?: boolean;
  /** Minimum relevance score for passing (default: 0.5) */
  minRelevanceScore?: number;
}

/**
 * LLM response format
 */
interface LLMEvaluation {
  domain_id: number;
  is_relevant: boolean;
  relevance_score: number;
  matched_keywords: string[];
  reasoning: string;
}

interface LLMResponse {
  evaluations: LLMEvaluation[];
}

/* ── Internal Types ── */

interface KeywordMatchData {
  domainId: number;
  domainName: string;
  keywords: Array<{ keyword: string; weight: number }>;
}

/* ── Stage 1: Keyword Pre-Filter ── */

/**
 * Stage 1: Quick keyword-based pre-filtering
 * Returns matched domains with their matched keywords
 */
async function keywordPreFilter(
  input: FilterInput
): Promise<{
  hasMatch: boolean;
  matchedDomains: Map<number, KeywordMatchData>;
}> {
  const db = getDb();
  const matchedDomains = new Map<number, KeywordMatchData>();

  // Get all active domains for user
  const activeDomains = await getActiveTopicDomains(input.userId);

  // Build search text from title and description
  const searchText = `${input.title} ${input.description}`.toLowerCase();

  for (const domain of activeDomains) {
    const keywords = await getActiveKeywordsForDomain(domain.id);
    const matchedKeywords: Array<{ keyword: string; weight: number }> = [];

    for (const kw of keywords) {
      if (searchText.includes(kw.keyword.toLowerCase())) {
        matchedKeywords.push({ keyword: kw.keyword, weight: kw.weight });
      }
    }

    if (matchedKeywords.length > 0) {
      matchedDomains.set(domain.id, {
        domainId: domain.id,
        domainName: domain.name,
        keywords: matchedKeywords,
      });
    }
  }

  return {
    hasMatch: matchedDomains.size > 0,
    matchedDomains,
  };
}

/* ── Stage 2: LLM Precise Filter ── */

/**
 * Build system prompt for LLM filtering
 */
async function buildFilterSystemPrompt(
  domains: Array<{ id: number; name: string; description: string | null; priority: number }>,
  keywordsMap: Map<number, Array<{ keyword: string; weight: number }>>
): Promise<string> {
  const domainsInfo = await Promise.all(
    domains.map(async (domain) => {
      const keywords = keywordsMap.get(domain.id) || [];
      return {
        id: domain.id,
        name: domain.name,
        description: domain.description || '',
        keywords: keywords.map((k) => k.keyword),
      };
    })
  );

  return `You are an academic literature filtering assistant. Your task is to evaluate whether a research article is relevant to given research domains.

# Research Domains
${domainsInfo.map((d) => `
## Domain ID: ${d.id} - ${d.name}
Description: ${d.description}
Keywords: ${d.keywords.join(', ')}
`).join('\n')}

# Evaluation Criteria
1. **Relevance**: Does the article meaningfully relate to the research domain?
2. **Novelty**: Does the article contribute new knowledge or insights?
3. **Specificity**: Is the content specific to the domain (not just tangentially related)?

# Scoring Guidelines
- **0.9-1.0**: Highly relevant, directly addresses core questions in the domain
- **0.7-0.8**: Relevant, provides meaningful insights for the domain
- **0.5-0.6**: Somewhat relevant, tangentially related or limited relevance
- **0.0-0.4**: Not relevant, no meaningful connection to the domain

# Response Format
You must respond with a JSON object in the following format:
\`\`\`json
{
  "evaluations": [
    {
      "domain_id": 1,
      "is_relevant": true,
      "relevance_score": 0.85,
      "matched_keywords": ["keyword1", "keyword2"],
      "reasoning": "Brief explanation of the relevance assessment"
    }
  ]
}
\`\`\`

# Important Notes
- Evaluate each domain independently
- An article can be relevant to multiple domains
- Only mark as relevant if the article has meaningful academic value for that domain
- Matched keywords should be from the provided keyword list for that domain
- Keep reasoning concise (1-2 sentences)`;
}

/**
 * Stage 2: LLM-based precise filtering
 */
async function llmFilter(
  input: FilterInput,
  matchedDomains: Map<number, KeywordMatchData>
): Promise<{
  results: Map<number, Omit<DomainMatchResult, 'domainName'>>;
  error?: string;
  rawResponse?: string;
}> {
  const db = getDb();

  // Get full domain info
  const activeDomains = await getActiveTopicDomains(input.userId);
  const relevantDomains = activeDomains.filter((d) => matchedDomains.has(d.id));

  if (relevantDomains.length === 0) {
    return { results: new Map() };
  }

  // Build keywords map for LLM prompt
  const keywordsMap = new Map<number, Array<{ keyword: string; weight: number }>>();
  for (const [domainId, data] of Array.from(matchedDomains.entries())) {
    keywordsMap.set(domainId, data.keywords);
  }

  // Build messages
  const systemPrompt = await buildFilterSystemPrompt(relevantDomains, keywordsMap);
  const userPrompt = `Please evaluate the following article:

# Article
Title: ${input.title}
Description: ${input.description}
${input.content ? `Content Preview: ${input.content.substring(0, 2000)}...` : ''}

Provide your evaluation in the specified JSON format.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const llm = await getUserLLMProvider(input.userId);
    const response = await llm.chat(messages, {
      jsonMode: true,
      temperature: 0.3,
      label: 'article-filter',
      maxTokens: 2048,
    });

    const parsed = JSON.parse(response) as LLMResponse;
    const results = new Map<number, Omit<DomainMatchResult, 'domainName'>>();

    for (const evaluation of parsed.evaluations) {
      const domainName = matchedDomains.get(evaluation.domain_id)?.domainName || '';
      results.set(evaluation.domain_id, {
        domainId: evaluation.domain_id,
        passed: evaluation.is_relevant,
        relevanceScore: evaluation.relevance_score,
        matchedKeywords: evaluation.matched_keywords,
        reasoning: evaluation.reasoning,
      });
    }

    log.debug(
      { articleId: input.articleId, evaluationCount: results.size },
      'LLM filter completed'
    );

    return { results, rawResponse: response };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn({ error: errorMessage, articleId: input.articleId }, 'LLM filter failed');
    return { results: new Map(), error: errorMessage };
  }
}

/* ── Fallback: Keyword-Only Matching ── */

/**
 * Fallback: Keyword-only matching when LLM fails
 */
function keywordOnlyFilter(
  matchedDomains: Map<number, KeywordMatchData>,
  minScore: number
): DomainMatchResult[] {
  const results: DomainMatchResult[] = [];

  for (const [domainId, data] of Array.from(matchedDomains.entries())) {
    // Calculate score based on keyword weights
    const avgWeight = data.keywords.reduce((sum, k) => sum + k.weight, 0) / data.keywords.length;
    // Max score for keyword-only is 0.8 (reserved for LLM-confirmed results)
    const score = Math.min(0.8, avgWeight * 0.5 + 0.3);

    if (score >= minScore) {
      results.push({
        domainId,
        domainName: data.domainName,
        passed: true,
        relevanceScore: score,
        matchedKeywords: data.keywords.map((k) => k.keyword),
        reasoning: 'Passed via keyword matching (LLM unavailable)',
      });
    }
  }

  return results;
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
  matchedKeywords: string[] | null,
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
      matched_keywords: matchedKeywords ? JSON.stringify(matchedKeywords) : null,
      filter_reason: filterReason,
      llm_response: llmResponse,
      created_at: new Date().toISOString(),
    })
    .execute();
}

/**
 * Record all filter results to database
 */
async function recordFilterResults(
  input: FilterInput,
  domainMatches: DomainMatchResult[],
  llmResponse: string | null
): Promise<void> {
  const db = getDb();

  // Record each domain evaluation
  for (const match of domainMatches) {
    await recordFilterLog(
      input.articleId,
      match.domainId,
      match.passed,
      match.relevanceScore ?? null,
      match.matchedKeywords ?? null,
      match.reasoning ?? null,
      null // Individual domain logs don't need full LLM response
    );
  }

  // If no domains matched, record a general rejection log
  if (domainMatches.length === 0) {
    await recordFilterLog(
      input.articleId,
      null,
      false,
      null,
      null,
      'No keyword matches found',
      llmResponse
    );
  }
}

/* ── Main Filter Function ── */

/**
 * Filter an article using two-stage filtering
 * @param input - Article data to filter
 * @param options - Filter options
 * @returns Filter result
 */
export async function filterArticle(
  input: FilterInput,
  options: FilterOptions = {}
): Promise<FilterResult> {
  const minScore = options.minRelevanceScore ?? 0.5;
  const requestLog = log.child({ articleId: input.articleId, userId: input.userId });

  requestLog.debug({ title: input.title }, 'Starting article filter');

  // Stage 1: Keyword pre-filter
  const keywordResult = await keywordPreFilter(input);

  if (!keywordResult.hasMatch) {
    requestLog.info('Article rejected: no keyword matches');
    await recordFilterLog(
      input.articleId,
      null,
      false,
      null,
      null,
      'No keyword matches'
    );
    // Auto-update filter_status to 'rejected'
    await updateArticleFilterStatus(input.articleId, 'rejected', 0);
    return {
      passed: false,
      domainMatches: [],
      filterReason: 'No keyword matches',
      usedFallback: false,
    };
  }

  // If skipLLM is set, use keyword-only matching
  if (options.skipLLM) {
    requestLog.debug('Using keyword-only filter (skipLLM=true)');
    const domainMatches = keywordOnlyFilter(keywordResult.matchedDomains, minScore);

    await recordFilterResults(input, domainMatches, null);

    // Auto-update filter_status
    const passed = domainMatches.length > 0;
    const relevanceScore = passed ? Math.max(...domainMatches.map((d) => d.relevanceScore ?? 0)) : 0;
    await updateArticleFilterStatus(input.articleId, passed ? 'passed' : 'rejected', relevanceScore);

    return {
      passed,
      relevanceScore: passed ? relevanceScore : undefined,
      matchedKeywords: passed ? Array.from(new Set(domainMatches.flatMap((d) => d.matchedKeywords ?? []))) : [],
      domainMatches,
      filterReason: passed ? 'Passed via keyword matching' : 'Failed keyword relevance threshold',
      usedFallback: true,
    };
  }

  // Stage 2: LLM filter
  const llmResult = await llmFilter(input, keywordResult.matchedDomains);

  // If LLM failed, fall back to keyword-only
  if (llmResult.error || llmResult.results.size === 0) {
    requestLog.warn({ error: llmResult.error }, 'LLM filter failed, using keyword fallback');
    const domainMatches = keywordOnlyFilter(keywordResult.matchedDomains, minScore);

    await recordFilterResults(input, domainMatches, llmResult.rawResponse ?? null);

    // Auto-update filter_status
    const passed = domainMatches.length > 0;
    const relevanceScore = passed ? Math.max(...domainMatches.map((d) => d.relevanceScore ?? 0)) : 0;
    await updateArticleFilterStatus(input.articleId, passed ? 'passed' : 'rejected', relevanceScore);

    return {
      passed,
      relevanceScore: passed ? relevanceScore : undefined,
      matchedKeywords: passed ? Array.from(new Set(domainMatches.flatMap((d) => d.matchedKeywords ?? []))) : [],
      domainMatches,
      filterReason: llmResult.error ? `LLM failed: ${llmResult.error}` : 'Passed via keyword matching (LLM unavailable)',
      usedFallback: true,
    };
  }

  // Process LLM results
  const domainMatches: DomainMatchResult[] = [];
  const domainNames = new Map(
    Array.from(keywordResult.matchedDomains.entries()).map(([id, data]) => [id, data.domainName])
  );

  for (const [domainId, result] of Array.from(llmResult.results.entries())) {
    const domainName = domainNames.get(domainId) || '';
    const matchResult: DomainMatchResult = {
      ...result,
      domainName,
    };
    domainMatches.push(matchResult);
  }

  await recordFilterResults(input, domainMatches, llmResult.rawResponse ?? null);

  // Determine overall pass/fail
  const passedMatches = domainMatches.filter((m) => m.passed && (m.relevanceScore ?? 0) >= minScore);
  const passed = passedMatches.length > 0;
  const relevanceScore = passed ? Math.max(...passedMatches.map((m) => m.relevanceScore ?? 0)) : 0;

  // Auto-update filter_status
  await updateArticleFilterStatus(input.articleId, passed ? 'passed' : 'rejected', relevanceScore);

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
    matchedKeywords: passed ? Array.from(new Set(passedMatches.flatMap((m) => m.matchedKeywords ?? []))) : [],
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

  await db
    .updateTable('articles')
    .set({
      filter_status: status,
      filter_score: score,
      filtered_at: now,
      updated_at: now,
    })
    .where('id', '=', articleId)
    .where('filter_status', '=', 'pending')  // Only update if still pending
    .execute();

  log.debug({ articleId, status, score }, 'Article filter status updated');
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
