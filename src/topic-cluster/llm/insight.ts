/**
 * 主题内洞察报告合成（单主题综述子簇 + 空白二次聚类后的每个元簇一次 LLM 调用）。
 *
 * 与主题综述的区别：这里处理的是同一主题下「已经写好的子簇综述」和
 * 「已经提出的空白」，目标是在子簇之间找收敛、张力、空白成熟度和可执行研究议程，
 * 而不是复述单篇文献或跨越大主题。
 */

import { CLUSTER_CONFIG, CLUSTER_LIMITS, CLUSTER_TASKS } from '../config.js';
import { runClusterJsonTask } from './client.js';
import {
  ClusterSchemaError,
  filterAllowedIds,
  optionalText,
  requireText,
} from './schema.js';

export type GapMaturityState = 'opening' | 'closing' | 'unaddressed';

export interface InsightLinkedText {
  text: string;
  reviewIds: number[];
  gapIds: number[];
}

export interface InsightGapMaturity {
  gapId: number;
  gap: string;
  state: GapMaturityState;
  reason: string;
}

export interface InsightReport {
  title: string;
  thesis: string;
  convergences: InsightLinkedText[];
  tensions: InsightLinkedText[];
  gapMaturity: InsightGapMaturity[];
  agenda: InsightLinkedText[];
}

export interface InsightReviewInput {
  id: number;
  title: string;
  abstract: string;
  topicName: string;
  sections: Record<string, string>;
}

export interface InsightGapInput {
  id: number;
  gap: string;
  basis: string;
  scope: 'subtopic' | 'topic';
  sourceReviewId: number | null;
  subtopicTitle: string | null;
  topicName: string;
  method: string | null;
  object: string | null;
}

export interface InsightInput {
  userId: number;
  scope: string;
  reviews: InsightReviewInput[];
  gaps: InsightGapInput[];
  previousReport: { title: string; thesis: string } | null;
  newRefKeys: string[];
}

const GAP_STATES: readonly GapMaturityState[] = ['opening', 'closing', 'unaddressed'];

export async function synthesizeInsightReport(input: InsightInput): Promise<InsightReport> {
  const previous = input.previousReport
    ? `${input.previousReport.title}\n${input.previousReport.thesis}`
    : '无（首次生成）';
  const changeContext =
    input.newRefKeys.length > 0 ? input.newRefKeys.join(', ') : '无新增节点';

  return runClusterJsonTask<InsightReport>({
    userId: input.userId,
    taskType: CLUSTER_TASKS.insight,
    promptType: 'cluster_insight',
    label: 'cluster_insight',
    maxTokens: CLUSTER_CONFIG.insightOutputTokens,
    temperature: 0.35,
    variables: {
      REPORT_SCOPE: input.scope,
      REVIEWS_JSON: JSON.stringify(input.reviews, null, 2),
      GAPS_JSON: JSON.stringify(input.gaps, null, 2),
      PREVIOUS_REPORT: previous,
      CHANGE_CONTEXT: changeContext,
    },
    validate: (raw) => parseInsightReport(raw, input),
  });
}

export function parseInsightReport(
  raw: Record<string, unknown>,
  input: InsightInput
): InsightReport {
  const title = truncate(requireText(raw.title, 'title', 4), 60);
  const thesis = truncate(optionalText(raw.thesis) ?? '', 300);
  const allowedReviews = new Set(input.reviews.map((review) => review.id));
  const allowedGaps = new Set(input.gaps.map((gap) => gap.id));
  const gapText = new Map(input.gaps.map((gap) => [gap.id, gap.gap]));

  const convergences = parseLinkedTexts(raw.convergences, allowedReviews, allowedGaps, 6);
  const tensions = parseLinkedTexts(raw.tensions, allowedReviews, allowedGaps, 6);
  const agenda = parseLinkedTexts(raw.agenda, allowedReviews, allowedGaps, 6);
  const gapMaturity = parseGapMaturity(raw.gap_maturity, allowedGaps, gapText);

  if (convergences.length === 0 && tensions.length === 0 && agenda.length === 0) {
    throw new ClusterSchemaError('洞察报告没有任何通过引用校验的结论');
  }

  return { title, thesis, convergences, tensions, gapMaturity, agenda };
}

function parseLinkedTexts(
  value: unknown,
  allowedReviews: ReadonlySet<number>,
  allowedGaps: ReadonlySet<number>,
  maxItems: number
): InsightLinkedText[] {
  if (!Array.isArray(value)) return [];
  const out: InsightLinkedText[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const text = optionalText(record.text);
    if (!text) continue;

    const reviewIds = filterAllowedIds(record.review_ids, allowedReviews);
    const gapIds = filterAllowedIds(record.gap_ids, allowedGaps);
    if (reviewIds.length === 0 && gapIds.length === 0) continue;

    out.push({ text: truncate(text, 360), reviewIds, gapIds });
    if (out.length >= maxItems) break;
  }
  return out;
}

function parseGapMaturity(
  value: unknown,
  allowedGaps: ReadonlySet<number>,
  gapText: ReadonlyMap<number, string>
): InsightGapMaturity[] {
  if (!Array.isArray(value)) return [];
  const out: InsightGapMaturity[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const gapId = typeof record.gap_id === 'number' ? record.gap_id : Number(record.gap_id);
    if (!Number.isFinite(gapId) || !allowedGaps.has(gapId)) continue;

    const reason = optionalText(record.reason);
    if (!reason) continue;

    const state =
      typeof record.state === 'string' &&
      (GAP_STATES as readonly string[]).includes(record.state)
        ? (record.state as GapMaturityState)
        : 'unaddressed';

    out.push({
      gapId,
      gap: gapText.get(gapId) ?? '',
      state,
      reason: truncate(reason, 240),
    });
    if (out.length >= CLUSTER_LIMITS.insightGapCap) break;
  }
  return out;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}
