/**
 * 切面抽取：全文总结 → 结构化切面（每篇一次 LLM）。
 *
 * 这是整个模块**最主要的 LLM 调用量**（冷启动 817 次，稳态每天 1~4 次），
 * 也是整条链上最大的单点风险：`study_object` / `method` 抽不干净，后面所有比较、
 * 脉络、空白推导都会串错（设计文档 §14.3）。
 */

import { CLUSTER_LIMITS, CLUSTER_TASKS } from '../config.js';
import type { FacetFields } from '../domain/facet.js';
import { METHOD_VOCAB_TEXT, OBJECT_VOCAB_TEXT } from '../domain/vocab.js';
import { runClusterJsonTask } from './client.js';
import { ClusterSchemaError, optionalText, requireText, textArray } from './schema.js';

export interface FacetExtractionInput {
  userId: number;
  articleId: number;
  title: string;
  aiSummary: string;
}

/** 单条证据的最大长度（与提示词约束一致） */
const MAX_QUOTE_CHARS = 60;

export async function extractFacet(input: FacetExtractionInput): Promise<FacetFields> {
  const summary = truncate(input.aiSummary, CLUSTER_LIMITS.facetInputMaxChars);

  return runClusterJsonTask<FacetFields>({
    userId: input.userId,
    taskType: CLUSTER_TASKS.facet,
    promptType: CLUSTER_TASKS.facet,
    label: `cluster_facet:${input.articleId}`,
    maxTokens: 1200,
    temperature: 0.1,
    variables: {
      ARTICLE_TITLE: input.title,
      AI_SUMMARY: summary,
      // 封闭词表注入提示词，与读路径归一（domain/vocab.ts）同源，不设第二份定义
      METHOD_VOCAB: METHOD_VOCAB_TEXT,
      OBJECT_VOCAB: OBJECT_VOCAB_TEXT,
    },
    validate: (raw) => {
      const facet: FacetFields = {
        research_question: requireText(raw.research_question, 'research_question', 4),
        method: requireText(raw.method, 'method', 2),
        study_object: requireText(raw.study_object, 'study_object', 2),
        core_finding: requireText(raw.core_finding, 'core_finding', 4),
        limitation: optionalText(raw.limitation) ?? undefined,
        angle_hint: optionalText(raw.angle_hint) ?? undefined,
        evidence_quotes: verifyQuotes(raw.evidence_quotes, `${input.title}\n${summary}`),
      };
      assertFieldsDistinct(facet);
      return facet;
    },
  });
}

/**
 * 结构性防线：四个判别性字段不可能内容相同。
 *
 * 这是对「输入没被真正喂给模型」最可靠的探测——不依赖占位词的具体措辞。
 * 实测过的典型症状是模型在无输入时把四字段一律填成「未明确说明」，
 * 这种情况下逐词黑名单很容易被绕开（换个说法就漏过），而「四字段完全相同」不会。
 */
function assertFieldsDistinct(facet: FacetFields): void {
  const values = [
    facet.research_question,
    facet.method,
    facet.study_object,
    facet.core_finding,
  ].map((value) => value.replace(/\s+/g, ''));

  if (new Set(values).size === 1) {
    throw new ClusterSchemaError(
      '四个判别性字段内容完全相同，判定为输入未被有效使用' +
        '（最常见原因是提示词模板缺少 {{ARTICLE_TITLE}} / {{AI_SUMMARY}} 占位符）'
    );
  }
}

/**
 * 证据原文核对：只保留确实出现在输入文本中的句子。
 *
 * 与参考项目 `ai-enrichment.ts` 的 evidence allowlist 同思路——
 * 证据的价值在于「可回链」，凭空生成的引用不如没有。
 */
export function verifyQuotes(value: unknown, source: string): string[] {
  const quotes = textArray(value, 5).filter((quote) => quote.length <= MAX_QUOTE_CHARS);
  if (quotes.length === 0) return [];
  const haystack = normalizeForMatch(source);
  const verified = quotes.filter((quote, index) => {
    const needle = normalizeForMatch(quote);
    if (needle.length < 6) return false;
    return haystack.includes(needle) && quotes.indexOf(quote) === index;
  });
  return verified.slice(0, 3);
}

function normalizeForMatch(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n（输入过长已截断）`;
}
