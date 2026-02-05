/**
 * Agent: Analyze scraped article content, generate summary + tags + insight + find related articles.
 *
 * Adapted from linkmind-master for RSS literature tracking.
 * Notes search removed (multi-tenant limitation), only historical articles search.
 */

import { getUserLLMProvider, getLLM, type ChatMessage } from './llm.js';
import { searchHistoricalArticles, type SearchResult } from './search.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'agent' });

/* ── Public Types ── */

export interface SummaryInput {
  url: string;
  title?: string;
  description?: string;
  markdown: string;
}

export interface SummaryResult {
  summary: string;    // Chinese summary (200-300 characters)
  tags: string[];     // Extracted keywords (3-5 tags)
}

export interface InsightResult {
  insight: string;    // Research insight (2-4 sentences)
  relatedArticles: SearchResult[];  // Related historical articles
}

export interface AnalysisResult {
  summary: string;
  tags: string[];
  insight: string;
  relatedArticles: SearchResult[];
}

/* ── Main Analysis Functions ── */

/**
 * Complete article analysis: summary + tags + insight + related articles.
 *
 * @param input - Article data with URL, title, description, and markdown content
 * @param userId - Optional user ID for filtering related articles
 * @returns Complete analysis result
 */
export async function analyzeArticle(
  input: SummaryInput,
  userId?: number
): Promise<AnalysisResult> {
  // Step 1: Generate summary and extract tags
  const summaryResult = await generateSummary(input, userId);

  // Step 2+3: Find related articles and generate insight
  const related = await findRelatedAndInsight(input, summaryResult.summary, userId);

  return {
    summary: summaryResult.summary,
    tags: summaryResult.tags,
    insight: related.insight,
    relatedArticles: related.relatedArticles,
  };
}

/**
 * Generate Chinese summary and extract tags from article content.
 *
 * @param input - Article data with URL, title, description, and markdown content
 * @param userId - Optional user ID for using user's LLM configuration
 * @returns Summary result with summary text and tags
 */
export async function generateSummary(input: SummaryInput, userId?: number): Promise<SummaryResult> {
  // Truncate markdown to avoid token limits (keep first 12000 chars)
  const content = input.markdown.slice(0, 12000);

  const systemPrompt = `你是一个学术文献分析助手。用户会给你一篇文章的内容，请你：
1. 用中文写一个简洁的摘要（3-5句话，200-300字），抓住文章的核心要点、研究方法和结论。无论原文是什么语言，摘要必须使用中文。
2. 提取 3-5 个关键标签（用于后续搜索关联内容），标签应该是文章的核心概念、技术术语或研究方向

以 JSON 格式输出：
{"summary": "...", "tags": ["tag1", "tag2", ...]}

注意：
- summary 字段必须是中文，不要使用英文
- tags 应该是简洁的术语，如：深度学习、Transformer、注意力机制、RAG、向量搜索
- 如果文章是新闻或博客而非学术文献，摘要应重点关注其实用价值和创新点`;

  const userMessage = `标题: ${input.title || '无'}
来源: ${input.url}
描述: ${input.description || '无'}

正文:
${content}`;

  const llm = userId ? await getUserLLMProvider(userId) : getLLM();
  const text = await llm.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    { maxTokens: 2048, jsonMode: true, label: 'summary' }
  );

  try {
    const parsed = JSON.parse(text);
    return {
      summary: parsed.summary || '无法生成摘要',
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
    };
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Failed to parse summary JSON, using raw text');
    return { summary: text.slice(0, 500), tags: [] };
  }
}

/**
 * Find related articles and generate research insight.
 *
 * @param input - Article data with URL, title, and markdown
 * @param summary - Generated summary from generateSummary()
 * @param userId - Optional user ID for filtering related articles
 * @returns Insight result with insight text and related articles
 */
export async function findRelatedAndInsight(
  input: { url: string; title?: string; markdown: string; articleId?: number },
  summary: string,
  userId?: number
): Promise<InsightResult> {
  // Search for related articles: combine title + summary into one query
  const query = [input.title, summary].filter(Boolean).join('\n');
  let relatedArticles = await searchHistoricalArticles(query, 5, userId);

  // Filter out the article itself from related results (by ID if provided)
  if (input.articleId) {
    relatedArticles = relatedArticles.filter((a) => a.articleId !== input.articleId);
  }

  // Generate insight with context of related articles
  const insight = await generateInsight(input, summary, relatedArticles, userId);

  return {
    insight,
    relatedArticles: relatedArticles.slice(0, 5),
  };
}

/**
 * Generate research insight with context of related articles.
 *
 * @param input - Article data with URL and title
 * @param summary - Generated summary
 * @param relatedArticles - Array of related historical articles
 * @param userId - Optional user ID for using user's LLM configuration
 * @returns Insight text (2-4 sentences in Chinese)
 */
async function generateInsight(
  input: { url: string; title?: string },
  summary: string,
  relatedArticles: SearchResult[],
  userId?: number
): Promise<string> {
  const articlesContext =
    relatedArticles.length > 0
      ? relatedArticles
          .map(
            (a) =>
              `- [${a.title}](${a.url})\n  ${a.snippet.slice(0, 100)}${
                a.snippet.length >= 100 ? '...' : ''
              }`
          )
          .join('\n')
      : '（无相关历史文章）';

  const systemPrompt = `你是用户的个人研究助手。用户关注学术文献和技术文章，特别关注 AI、机器学习、软件开发等领域。

你的任务是从**用户的角度**思考这篇文章的研究价值和实用价值：
- 这篇文章的核心贡献是什么？有什么值得关注的创新点？
- 和用户过去阅读过的文章有什么关联？是否能形成知识网络？
- 对用户的研究方向或项目有什么启发？
- 是否值得深入研究或作为参考资料？

语气要像朋友之间的分享，简洁有力，不要模板化的套话。2-4 句话即可，必须使用中文。`;

  const userMessage = `文章: ${input.title || input.url}
链接: ${input.url}

摘要:
${summary}

用户阅读过的相关文章:
${articlesContext}

请给出你的研究洞察（Insight）：`;

  const llm = userId ? await getUserLLMProvider(userId) : getLLM();
  const text = await llm.chat(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    { maxTokens: 1024, label: 'insight' }
  );

  return text || '无法生成洞察';
}

/* ── Utility Functions ── */

/**
 * Deduplicate array by key function.
 * (Not currently used, kept for reference)
 */
function dedup<T>(arr: T[], keyFn: (item: T) => string | undefined): T[] {
  const seen = new Set<string>();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
