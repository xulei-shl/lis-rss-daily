/**
 * 子主题独立研究空白分析（主题内每个语义子簇一次独立 LLM 调用）。
 *
 * 与主题级阶段 B 空白的区别：
 *   - 只聚焦当前子课题，喂入该子课题「全量成员」切面（含完整自陈局限）+ 局部矩阵；
 *   - 产出 basis = 'llm_analysis' 的高纯度局部研究空白，直接挂载到本子课题下；
 *   - 严格沿用白名单文献引用校验，无有效引用的条目丢弃，绝不写空话。
 */

import { CLUSTER_CONFIG, CLUSTER_LIMITS, CLUSTER_TASKS } from '../config.js';
import { runClusterJsonTask } from './client.js';
import { ClusterSchemaError, filterAllowedIds, optionalText } from './schema.js';

export interface SubtopicMemberFacetInput {
  articleId: number;
  title: string;
  year: number | null;
  researchQuestion: string;
  method: string;
  studyObject: string;
  coreFinding: string;
  limitation: string | null;
}

export interface SubtopicGapItem {
  gap: string;
  basis: 'llm_analysis';
  evidenceArticleIds: number[];
}

export interface SubtopicGapsInput {
  userId: number;
  topicName: string;
  topicKeywords: string[];
  subtopicStats: string;
  reviewContext: string;
  members: SubtopicMemberFacetInput[];
  allowedArticleIds: ReadonlySet<number>;
}

export async function synthesizeSubtopicGaps(
  input: SubtopicGapsInput
): Promise<SubtopicGapItem[]> {
  return runClusterJsonTask<SubtopicGapItem[]>({
    userId: input.userId,
    taskType: CLUSTER_TASKS.review,
    promptType: 'cluster_subtopic_gaps',
    label: 'cluster_subtopic_gaps',
    maxTokens: CLUSTER_CONFIG.subtopicGapsOutputTokens,
    temperature: 0.3,
    variables: {
      TOPIC_NAME: input.topicName,
      TOPIC_KEYWORDS: input.topicKeywords.join('、') || '未提供',
      SUBTOPIC_STATS: input.subtopicStats,
      REVIEW_CONTEXT: input.reviewContext || '暂无综述摘要',
      MEMBERS_JSON: JSON.stringify(input.members, null, 2),
    },
    validate: (raw) => parseSubtopicGaps(raw, input.allowedArticleIds),
  });
}

export function parseSubtopicGaps(
  raw: Record<string, unknown>,
  allowedArticleIds: ReadonlySet<number>
): SubtopicGapItem[] {
  if (!Array.isArray(raw.gaps)) {
    throw new ClusterSchemaError('子主题研究空白响应缺少 gaps 数组');
  }

  const out: SubtopicGapItem[] = [];
  const seen = new Set<string>();

  for (const item of raw.gaps) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const gap = optionalText(record.gap);
    if (!gap) continue;

    const evidenceArticleIds = filterAllowedIds(record.evidence_article_ids, allowedArticleIds);
    if (evidenceArticleIds.length === 0) continue;

    const normalized = normalizeGapText(gap);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    out.push({
      gap: truncate(gap, 160),
      basis: 'llm_analysis',
      evidenceArticleIds,
    });
    if (out.length >= CLUSTER_LIMITS.subtopicMaxGaps) break;
  }

  if (raw.gaps.length > 0 && out.length === 0) {
    throw new ClusterSchemaError('子主题研究空白没有任何通过证据校验的条目');
  }

  return out;
}

function normalizeGapText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}
