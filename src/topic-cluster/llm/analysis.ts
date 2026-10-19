/**
 * 多维分析合成：把「规则已算好的结构」写成可读叙述（每个 dirty 主题一次 LLM）。
 *
 * 关键设计（设计文档 §7.7）：
 *   - 输入是**已成链的排序结构 + 覆盖矩阵 + 周期指标**，不是一堆无序文章；
 *   - LLM 的职责是「命名与叙述」，不是「判断相关性」——判定早已由规则完成；
 *   - 所有引用必须落在输入给出的 article_id 白名单内，越界整条丢弃。
 */

import { CLUSTER_TASKS } from '../config.js';
import type { Trend } from '../domain/metrics.js';
import { runClusterJsonTask } from './client.js';
import { optionalText, requireText, textArray, oneOf } from './schema.js';

/**
 * 空白的依据类型。
 *
 * 每一种都**必须**在提示词输入里有对应的结构化信号，否则模型只能编：
 *   - matrix_hole  方法×对象覆盖矩阵的空格（已喂入）
 *   - staleness    周期指标中的时效缺口（已喂入）
 *   - limitation   文献自陈局限字段（已喂入）
 *
 * 刻意不含「邻近主题间的空白」——当前未把跨主题比较结果喂给模型，
 * 列为后续扩展（设计文档 §7.8 的簇间邻近空白）。
 */
export type GapBasis = 'matrix_hole' | 'staleness' | 'limitation';

const GAP_BASES: readonly GapBasis[] = ['matrix_hole', 'staleness', 'limitation'];
const TRENDS: readonly Trend[] = ['up', 'flat', 'down'];

/** 单条空白最多 3 条（更多会稀释可信度） */
const MAX_GAPS = 3;

export interface AnalysisAngle {
  angleKey: string;
  label: string;
  narrative: string;
}

export interface AnalysisGap {
  gap: string;
  basis: GapBasis;
  evidenceArticleIds: number[];
}

export interface AnalysisResult {
  overview: string;
  angles: AnalysisAngle[];
  trend: {
    summary: string;
    direction: Trend;
    evidenceArticleIds: number[];
  };
  gaps: AnalysisGap[];
  consensus: string[];
  controversies: string[];
  historySummary: string | null;
}

export interface AnalysisInput {
  userId: number;
  topicName: string;
  topicKeywords: string[];
  /** 规则计算的统计 + 替代指标（月度序列、漂移、熵） */
  statsText: string;
  /** 角度/线索结构化清单（含 article_id 与关系标记） */
  threadsJson: string;
  /** method × study_object 覆盖矩阵摘要（含空缺格） */
  matrixSummary: string;
  /** 引用白名单：本次输入里出现过的全部 article_id */
  allowedArticleIds: ReadonlySet<number>;
  /** 允许出现的 angle_key（超出即丢弃该角度） */
  allowedAngleKeys: ReadonlySet<string>;
}

export async function synthesizeAnalysis(input: AnalysisInput): Promise<AnalysisResult> {
  return runClusterJsonTask<AnalysisResult>({
    userId: input.userId,
    taskType: CLUSTER_TASKS.analysis,
    promptType: CLUSTER_TASKS.analysis,
    label: 'cluster_analysis',
    maxTokens: 3000,
    temperature: 0.3,
    variables: {
      TOPIC_NAME: input.topicName,
      TOPIC_KEYWORDS: input.topicKeywords.join('、'),
      TOPIC_STATS: input.statsText,
      THREADS_JSON: input.threadsJson,
      MATRIX_SUMMARY: input.matrixSummary,
    },
    validate: (raw) => ({
      overview: requireText(raw.overview, 'overview', 20),
      angles: parseAngles(raw.angles, input.allowedAngleKeys),
      trend: parseTrend(raw.trend, input.allowedArticleIds),
      gaps: parseGaps(raw.gaps, input.allowedArticleIds),
      consensus: textArray(raw.consensus, 5),
      controversies: textArray(raw.controversies, 5),
      historySummary: optionalText(raw.history_summary),
    }),
  });
}

/* ── 各字段解析（逐条丢弃非法项，而不是整份失败） ── */

function parseAngles(value: unknown, allowed: ReadonlySet<string>): AnalysisAngle[] {
  if (!Array.isArray(value)) return [];
  const out: AnalysisAngle[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const angleKey = typeof record.angle_key === 'string' ? record.angle_key : '';
    // angle_key 必须是输入里真实存在的角度，防止 LLM 凭空造角度
    if (!allowed.has(angleKey) || seen.has(angleKey)) continue;

    const label = optionalText(record.label);
    const narrative = optionalText(record.narrative);
    if (!label || !narrative) continue;

    seen.add(angleKey);
    out.push({ angleKey, label, narrative });
  }
  return out;
}

function parseTrend(
  value: unknown,
  allowed: ReadonlySet<number>
): { summary: string; direction: Trend; evidenceArticleIds: number[] } {
  const record = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    summary: optionalText(record.summary) ?? '',
    direction: oneOf(record.direction, TRENDS, 'flat'),
    evidenceArticleIds: filterIds(record.evidence_article_ids, allowed),
  };
}

function parseGaps(value: unknown, allowed: ReadonlySet<number>): AnalysisGap[] {
  if (!Array.isArray(value)) return [];
  const out: AnalysisGap[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const gap = optionalText(record.gap);
    if (!gap) continue;

    const ids = filterIds(record.evidence_article_ids, allowed);
    // 空白必须可回链：无有效引用的空白直接丢弃，避免退化成「AI 空话」
    if (ids.length === 0) continue;

    out.push({
      gap,
      basis: oneOf(record.basis, GAP_BASES, 'limitation'),
      evidenceArticleIds: ids,
    });
    if (out.length >= MAX_GAPS) break;
  }
  return out;
}

function filterIds(value: unknown, allowed: ReadonlySet<number>): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const id = typeof item === 'number' ? item : Number(item);
    if (!Number.isFinite(id)) continue;
    if (allowed.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
