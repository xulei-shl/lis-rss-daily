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
import { getUserLLMProvider, type ChatMessage } from './llm.js';
import { logger } from './logger.js';
import { getActiveTopicDomains } from './api/topic-domains.js';
import { getActiveKeywordsForDomain } from './api/topic-keywords.js';
import { resolveSystemPrompt } from './api/system-prompts.js';

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
  /** 强制仅关键词模式（跳过 LLM） */
  skipLLM?: boolean;
  /** 是否启用关键词预筛（默认 false） */
  useKeywordPrefilter?: boolean;
  /** 通过的最低相关度分数（默认 0.5） */
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
  keywords: Array<{ keyword: string; description: string | null; weight: number }>;
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
    const matchedKeywords: Array<{ keyword: string; description: string | null; weight: number }> = [];

    for (const kw of keywords) {
      if (searchText.includes(kw.keyword.toLowerCase())) {
        matchedKeywords.push({ keyword: kw.keyword, description: kw.description, weight: kw.weight });
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

/**
 * 构建全部活跃领域的关键词数据（预筛关闭时使用）
 */
async function buildAllDomainsMatchData(
  userId: number
): Promise<Map<number, KeywordMatchData>> {
  const matchedDomains = new Map<number, KeywordMatchData>();
  const activeDomains = await getActiveTopicDomains(userId);

  for (const domain of activeDomains) {
    const keywords = await getActiveKeywordsForDomain(domain.id);
    if (keywords.length === 0) {
      continue;
    }
    matchedDomains.set(domain.id, {
      domainId: domain.id,
      domainName: domain.name,
      keywords: keywords.map((k) => ({
        keyword: k.keyword,
        description: k.description,
        weight: k.weight,
      })),
    });
  }

  return matchedDomains;
}

/* ── Stage 2: LLM Precise Filter ── */

/**
 * Build system prompt for LLM filtering
 */
function buildFilterSystemPromptFromDomainsInfo(
  domainsInfo: Array<{
    id: number;
    name: string;
    description: string;
    keywords: Array<{ keyword: string; description: string; weight: number }>;
  }>
): string {
  const domainsText = formatDomainsInfo(domainsInfo);
  return `# Role
你是一个专业的文章内容筛选与评估助手。你的核心任务是根据用户提供的【关注领域配置】（包含主题领域、主题词、权重及描述），对输入的【文章信息】（题目、摘要）进行深度分析，判断该文章是否符合用户的阅读需求，并给出“通过”或“拒绝”的决策。

# Context & Constraints
1. **语义匹配**：不要仅进行简单的关键词匹配。必须结合【描述】字段中的解释或同义词，对文章进行语义层面的理解。
2. **权重逻辑**：
   - 【权重】字段为数字，数值越大代表越重要。
   - 命中高权重的主题领域或主题词，应显著提高文章的通过率。
   - 仅命中低权重词汇且与核心领域关联不强时，应倾向于拒绝。
3. **综合评估**：文章必须在核心概念上与用户关注的领域高度重合，而非仅仅是提及。

# Input Data Structure
用户将提供两部分信息：
1. **关注配置**：包含领域（Domain）、该领域下的主题词（Keywords）、权重（Weight）、描述（Description）。
2. **文章信息**：包含题目（Title）、摘要（Abstract）。

# Workflow
1. **分析文章**：提取题目和摘要中的核心概念、研究对象、方法和结论。
2. **映射匹配**：将提取的概念与用户的【关注配置】进行比对。利用【描述】字段扩展语义范围（例如：若描述中包含同义词，则视为命中）。
3. **加权评估**：
   - 识别命中了哪些领域和主题词。
   - 根据命中的项目权重进行综合打分。
   - *判定标准*：
     - **通过**：文章核心内容强关联高权重领域/词汇，或关联多个中等权重词汇。
     - **拒绝**：文章内容与关注领域无关，或仅边缘提及低权重词汇，或属于关注领域的反面案例。
4. **生成结果**：输出最终决策及简短理由。

# 关注领域配置
${domainsText}

# Response Format
请严格按照以下 JSON 格式输出结果（不要输出多余内容）：
\`\`\`json
{
  "evaluations": [
    {
      "domain_id": 1,
      "is_relevant": true,
      "relevance_score": 0.85,
      "matched_keywords": ["keyword1", "keyword2"],
      "reasoning": "简短说明相关性（1-2句）"
    }
  ]
}
\`\`\`

# Important Notes
- 每个领域独立评估
- 一篇文章可以与多个领域相关
- 只有具有实质性关联时才标记为相关
- matched_keywords 必须来自该领域的主题词列表
- reasoning 保持简洁（1-2句）`;
}

async function buildDomainInfo(
  domains: Array<{ id: number; name: string; description: string | null; priority: number }>,
  keywordsMap: Map<number, Array<{ keyword: string; description: string | null; weight: number }>>
): Promise<Array<{
  id: number;
  name: string;
  description: string;
  keywords: Array<{ keyword: string; description: string; weight: number }>;
}>> {
  return Promise.all(
    domains.map(async (domain) => {
      const keywords = keywordsMap.get(domain.id) || [];
      return {
        id: domain.id,
        name: domain.name,
        description: domain.description || '',
        keywords: keywords.map((k) => ({
          keyword: k.keyword,
          description: k.description || '',
          weight: k.weight,
        })),
      };
    })
  );
}

function formatDomainsInfo(
  domainsInfo: Array<{
    id: number;
    name: string;
    description: string;
    keywords: Array<{ keyword: string; description: string; weight: number }>;
  }>
): string {
  return domainsInfo
    .map((d) => `
## 领域ID: ${d.id} - ${d.name}
描述: ${d.description}
主题词:
${d.keywords
  .map((k) => {
    const descPart = k.description ? `，描述/同义词：${k.description}` : '';
    return `- ${k.keyword}（权重：${k.weight}${descPart}）`;
  })
  .join('\n')}
`)
    .join('\n');
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
  const keywordsMap = new Map<number, Array<{ keyword: string; description: string | null; weight: number }>>();
  for (const [domainId, data] of Array.from(matchedDomains.entries())) {
    keywordsMap.set(domainId, data.keywords);
  }

  // Build messages
  const domainsInfo = await buildDomainInfo(relevantDomains, keywordsMap);
  const domainsText = formatDomainsInfo(domainsInfo);
  const fallbackSystemPrompt = buildFilterSystemPromptFromDomainsInfo(domainsInfo);
  const systemPrompt = await resolveSystemPrompt(input.userId, 'filter', fallbackSystemPrompt, {
    TOPIC_DOMAINS: domainsText,
    ARTICLE_TITLE: input.title || '无',
    ARTICLE_URL: input.url || '无',
    ARTICLE_CONTENT: input.content ? input.content.substring(0, 2000) : '',
  });
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
      match.matchedKeywords ?? null,
      match.reasoning ?? null,
      null // Individual domain logs don't need full LLM response
    );
  }

  const hasDomainLog = domainMatches.length > 0;
  const llmResponse = options.llmResponse ?? null;
  const reason = options.fallbackReason
    || (hasDomainLog ? 'LLM 原始响应' : 'No keyword matches found');

  if (!hasDomainLog || llmResponse) {
    await recordFilterLog(
      input.articleId,
      null,
      options.overallPassed,
      null,
      null,
      reason,
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
  let keywordResult: Awaited<ReturnType<typeof keywordPreFilter>> | null = null;

  if (options.useKeywordPrefilter) {
    keywordResult = await keywordPreFilter(input);

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
  }

  // If skipLLM is set, use keyword-only matching
  if (options.skipLLM) {
    requestLog.debug('Using keyword-only filter (skipLLM=true)');
    if (!keywordResult) {
      requestLog.warn('skipLLM=true requires keyword prefilter; forcing prefilter');
      keywordResult = await keywordPreFilter(input);
    }
    const domainMatches = keywordOnlyFilter(keywordResult.matchedDomains, minScore);

    // Auto-update filter_status
    const passed = domainMatches.length > 0;
    const relevanceScore = passed ? Math.max(...domainMatches.map((d) => d.relevanceScore ?? 0)) : 0;
    await updateArticleFilterStatus(input.articleId, passed ? 'passed' : 'rejected', relevanceScore);

    await recordFilterResults(input, domainMatches, {
      overallPassed: passed,
      fallbackReason: passed ? 'Passed via keyword matching' : 'Failed keyword relevance threshold',
    });

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
  const llmMatchedDomains = keywordResult
    ? keywordResult.matchedDomains
    : await buildAllDomainsMatchData(input.userId);
  const llmResult = await llmFilter(input, llmMatchedDomains);

  // If LLM failed, fall back to keyword-only
  if (llmResult.error || llmResult.results.size === 0) {
    requestLog.warn({ error: llmResult.error }, 'LLM filter failed, using keyword fallback');
    if (!keywordResult) {
      keywordResult = await keywordPreFilter(input);
    }
    const domainMatches = keywordOnlyFilter(keywordResult.matchedDomains, minScore);

    // Auto-update filter_status
    const passed = domainMatches.length > 0;
    const relevanceScore = passed ? Math.max(...domainMatches.map((d) => d.relevanceScore ?? 0)) : 0;
    await updateArticleFilterStatus(input.articleId, passed ? 'passed' : 'rejected', relevanceScore);

    await recordFilterResults(input, domainMatches, {
      llmResponse: llmResult.rawResponse ?? null,
      overallPassed: passed,
      fallbackReason: llmResult.error
        ? `LLM failed: ${llmResult.error}`
        : 'Passed via keyword matching (LLM unavailable)',
    });

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
    Array.from(llmMatchedDomains.entries()).map(([id, data]) => [id, data.domainName])
  );

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
