/**
 * 多维分析编排。
 *
 * 职责分工（设计文档 §7.7）：
 *   - **规则层**先把矩阵、周期指标、角度/线索结构算好（零 token）；
 *   - **LLM 层**只把这些结构写成叙述，并强制引用白名单；
 *   - 失败时保留上一次成功结果并标记 status='failed'，**绝不写占位文本**。
 *
 * 调用频率由 is_dirty 决定（实测约 0~3 次/天），页面访问不触发 LLM。
 */

import { createHash } from 'node:crypto';
import { logger } from '../../logger.js';
import { CLUSTER_CONFIG, CLUSTER_LIMITS, type AnalysisStatus } from '../config.js';
import type { Trend } from '../domain/metrics.js';
import { type AnalysisResult, synthesizeAnalysis } from '../llm/analysis.js';
import { ClusterSchemaError } from '../llm/schema.js';
import { getTopicAnalysis, upsertTopicAnalysis } from '../repo/analysis.js';
import { listTopicMetrics } from '../repo/metrics.js';
import { listThreadArticles, listThreads, updateThreadNarrative } from '../repo/threads.js';
import { getTopicById } from '../repo/topics.js';
import { buildMatrix, renderMatrixSummary } from './matrix.js';
import { loadTopicMembers } from './member-view.js';
import { renderMetricsSummary } from './metrics-builder.js';

const log = logger.child({ module: 'topic-cluster/analysis-runner' });

export interface AnalysisRunResult {
  topicId: number;
  status: AnalysisStatus;
  angleCount: number;
  gapCount: number;
  error: string | null;
}

export interface RunAnalysisOptions {
  /** 强制重算（忽略 inputHash 与 is_dirty 判断） */
  force?: boolean;
}

export async function runTopicAnalysis(
  topicId: number,
  options: RunAnalysisOptions = {}
): Promise<AnalysisRunResult> {
  const dbTopic = await getTopicById(topicId);
  if (!dbTopic) {
    return { topicId, status: 'failed', angleCount: 0, gapCount: 0, error: '主题不存在' };
  }

  const { members } = await loadTopicMembers(topicId);
  const keywords = parseKeywords(dbTopic.keywords);

  // 规则层：矩阵（零 token，任何情况下都要写，保证前端「对比矩阵」始终可用）
  const matrix = buildMatrix(
    members.map((member) => ({
      articleId: member.articleId,
      methodKeys: member.methodKeys,
      objectKeys: member.objectKeys,
    })),
    { minCount: CLUSTER_LIMITS.matrixMinCount, maxHoles: 12 }
  );

  // 降级：样本不足时不调用 LLM，只出规则部分
  if (members.length < CLUSTER_LIMITS.minArticlesForAnalysis) {
    await upsertTopicAnalysis({
      topicId,
      analysisJson: JSON.stringify(emptyAnalysis()),
      matrixJson: JSON.stringify(matrix),
      inputHash: '',
      linkedCount: members.length,
      contractVersion: CLUSTER_CONFIG.facetContractVersion,
      status: 'insufficient_data',
      errorMessage: `文章数 ${members.length} 低于阈值 ${CLUSTER_LIMITS.minArticlesForAnalysis}，仅输出规则聚合结果`,
    });
    return {
      topicId,
      status: 'insufficient_data',
      angleCount: 0,
      gapCount: 0,
      error: null,
    };
  }

  // 输入指纹：成员集合 + 切面内容 + 角度结构；未变化则跳过
  const metricRows = await listTopicMetrics(topicId);
  const threads = await listThreads(topicId);
  const threadArticleRows = await listThreadArticles(topicId);
  const inputHash = computeInputHash({
    topicId,
    name: dbTopic.name,
    memberIds: members.map((member) => member.articleId),
    facetTexts: members.map((member) => buildFacetSignature(member)),
    angleKeys: threads.map((thread) => thread.angle_key),
  });

  if (!options.force) {
    const existing = await getTopicAnalysis(topicId);
    if (existing && existing.input_hash === inputHash && existing.status === 'ok') {
      return { topicId, status: 'ok', angleCount: threads.length, gapCount: 0, error: null };
    }
  }

  const threadPayload = buildThreadPayload(members, threads, threadArticleRows);
  const allowedArticleIds = new Set(members.map((member) => member.articleId));
  const allowedAngleKeys = new Set(threads.map((thread) => thread.angle_key));

  try {
    const result = await synthesizeAnalysis({
      userId: dbTopic.user_id,
      topicName: dbTopic.name,
      topicKeywords: keywords,
      statsText: renderMetricsSummary(metricRows),
      threadsJson: JSON.stringify(threadPayload, null, 2),
      matrixSummary: renderMatrixSummary(matrix),
      allowedArticleIds,
      allowedAngleKeys,
    });

    await upsertTopicAnalysis({
      topicId,
      analysisJson: JSON.stringify(result),
      matrixJson: JSON.stringify(matrix),
      inputHash,
      linkedCount: members.length,
      contractVersion: CLUSTER_CONFIG.facetContractVersion,
      status: 'ok',
      errorMessage: null,
    });

    await applyAngleNarratives(threads, result);

    return {
      topicId,
      status: 'ok',
      angleCount: result.angles.length,
      gapCount: result.gaps.length,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const severity = error instanceof ClusterSchemaError ? '已被 schema 校验拒收' : '调用失败';
    log.warn({ topicId, error: message }, `主题分析${severity}，保留上一次结果`);

    // 保留上一次成功结果，仅标记失败（前端据此提示「分析待更新」）
    const previous = await getTopicAnalysis(topicId);
    await upsertTopicAnalysis({
      topicId,
      analysisJson: previous?.analysis_json ?? JSON.stringify(emptyAnalysis()),
      matrixJson: JSON.stringify(matrix),
      inputHash,
      linkedCount: members.length,
      contractVersion: CLUSTER_CONFIG.facetContractVersion,
      status: 'failed',
      errorMessage: message,
    });

    return { topicId, status: 'failed', angleCount: 0, gapCount: 0, error: message };
  }
}

/* ── 输入组装 ── */

/** 把角度/线索结构渲染成给 LLM 的清单（含 article_id 与关系标记） */
function buildThreadPayload(
  members: Awaited<ReturnType<typeof loadTopicMembers>>['members'],
  threads: Awaited<ReturnType<typeof listThreads>>,
  threadArticles: Awaited<ReturnType<typeof listThreadArticles>>
): unknown {
  const memberMap = new Map(members.map((member) => [member.articleId, member]));

  return {
    angles: threads.map((thread) => ({
      angle_key: thread.angle_key,
      article_count: thread.article_count,
      period_start: thread.period_start,
      period_end: thread.period_end,
      trend: thread.trend,
      articles: threadArticles
        .filter((row) => row.thread_id === thread.id)
        .map((row) => {
          const member = memberMap.get(row.article_id);
          return {
            article_id: row.article_id,
            seq: row.seq,
            relation: row.relation,
            similarity_to_prev: row.similarity_to_prev,
            shared_method: row.shared_method === 1,
            shared_object: row.shared_object === 1,
            research_question: member?.facet.research_question ?? '',
            method: member?.facet.method ?? '',
            study_object: member?.facet.study_object ?? '',
            core_finding: member?.facet.core_finding ?? '',
            limitation: member?.facet.limitation ?? '',
            event_date: member?.eventDate ?? null,
            date_precision: member?.precision ?? null,
          };
        }),
    })),
  };
}

/** 把 LLM 产出的角度名与叙述回填到脉络表（按 angle_key 匹配） */
async function applyAngleNarratives(
  threads: Awaited<ReturnType<typeof listThreads>>,
  result: AnalysisResult
): Promise<void> {
  const byKey = new Map(result.angles.map((angle) => [angle.angleKey, angle]));
  for (const thread of threads) {
    const angle = byKey.get(thread.angle_key);
    if (!angle) continue;
    if (thread.angle_label === angle.label && thread.summary === angle.narrative) continue;
    await updateThreadNarrative(thread.id, angle.label, angle.narrative);
  }
}

/* ── 工具 ── */

function computeInputHash(input: {
  topicId: number;
  name: string;
  memberIds: number[];
  facetTexts: string[];
  angleKeys: string[];
}): string {
  const hash = createHash('sha256');
  hash.update(`topic:${input.topicId}|name:${input.name}|contract:${CLUSTER_CONFIG.facetContractVersion}`);
  hash.update(`|members:${input.memberIds.join(',')}`);
  hash.update(`|angles:${input.angleKeys.join(',')}`);
  for (const text of input.facetTexts) hash.update(`|${text}`);
  return hash.digest('hex');
}

function buildFacetSignature(member: { articleId: number; facet: { research_question: string; method: string; study_object: string; core_finding: string } }): string {
  return [
    member.articleId,
    member.facet.research_question,
    member.facet.method,
    member.facet.study_object,
    member.facet.core_finding,
  ].join('\u0001');
}

function parseKeywords(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
  return [];
}

/**
 * 降级/失败时的空分析骨架。
 * 注意：字段为 null / 空数组，前端据此显示「未生成」，而不是展示编造内容。
 */
function emptyAnalysis(): {
  overview: string;
  angles: never[];
  trend: { summary: string; direction: Trend; evidenceArticleIds: number[] };
  gaps: never[];
  consensus: never[];
  controversies: never[];
  historySummary: null;
} {
  return {
    overview: '',
    angles: [],
    trend: { summary: '', direction: 'flat', evidenceArticleIds: [] },
    gaps: [],
    consensus: [],
    controversies: [],
    historySummary: null,
  };
}
