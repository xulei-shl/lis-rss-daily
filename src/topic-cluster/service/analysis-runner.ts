/**
 * 多维分析编排（两阶段）。
 *
 * 职责分工（设计文档 v2 §3）：
 *   - **规则层**先把矩阵、周期指标、角度/线索结构算好（零 token）；
 *   - **LLM 阶段 A** 写 overview / synthesis / 角度叙述；
 *   - **LLM 阶段 B** 写范式、前沿、计量与空白；
 *   - 阶段 A 成功即落库为 `partial`，阶段 B 失败可单独重试，**绝不写占位文本**。
 *
 * 调用频率由 is_dirty 决定（实测约 0~3 次/天），页面访问不触发 LLM。
 */

import { createHash } from 'node:crypto';
import { logger } from '../../logger.js';
import { CLUSTER_CONFIG, CLUSTER_LIMITS, type AnalysisStatus } from '../config.js';
import {
  emptyAnalysisResult,
  mergeAnalysisResult,
  synthesizeParadigms,
  synthesizeSynthesis,
  type AnalysisResult,
  type AnalysisSynthesis,
  type PhaseAResult,
} from '../llm/analysis.js';
import { ClusterSchemaError } from '../llm/schema.js';
import { getTopicAnalysis, upsertTopicAnalysis } from '../repo/analysis.js';
import { listTopicMetrics } from '../repo/metrics.js';
import { listThreadArticles, listThreads, updateThreadNarrative } from '../repo/threads.js';
import { getTopicById } from '../repo/topics.js';
import { getArticleBriefs } from '../source.js';
import { describePackedInput, packAnalysisInput, type PackedAnalysisInput } from './analysis-payload.js';
import { buildCrossTopicGaps, type CrossTopicGap } from './gap-builder.js';
import { buildMatrix } from './matrix.js';
import { loadTopicMembers } from './member-view.js';
import { buildParadigmDomains, type ParadigmDomain } from './paradigm.js';

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
      analysisJson: JSON.stringify(emptyAnalysisResult()),
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

  const metricRows = await listTopicMetrics(topicId);
  const threads = await listThreads(topicId);
  const threadArticleRows = await listThreadArticles(topicId);
  const briefs = await getArticleBriefs(members.map((member) => member.articleId));
  const previous = await getTopicAnalysis(topicId);
  const previousResult = previous ? parseStoredResult(previous.analysis_json) : null;

  const paradigmDomains = buildParadigmDomains(matrix, members).domains;
  const crossTopicGaps = await buildCrossTopicGaps(topicId, dbTopic.set_version, members);

  const packParams = {
    topicName: dbTopic.name,
    topicKeywords: keywords,
    members,
    threads,
    threadArticles: threadArticleRows,
    matrix,
    metrics: metricRows,
    briefs,
    previousOverview: previousResult?.overview ?? null,
  };
  const packed = packAnalysisInput({
    ...packParams,
    budget: CLUSTER_CONFIG.analysisInputCharBudget,
  });
  // 阶段 B 额外携带范式域与跨主题空白；阶段 A 不付这份 token。
  const packedB = packAnalysisInput({
    ...packParams,
    paradigmDomains,
    crossTopicGaps,
    budget: CLUSTER_CONFIG.analysisInputCharBudget,
  });

  const inputHash = computeInputHash({
    topicId,
    name: dbTopic.name,
    memberIds: members.map((member) => member.articleId),
    facetTexts: members.map((member) => buildFacetSignature(member)),
    angleKeys: threads.map((thread) => `${thread.angle_key}:${thread.pattern_type}`),
    representativeIds: threadArticleRows
      .filter((row) => row.is_representative === 1)
      .map((row) => row.article_id),
  });

  if (!options.force && previous && previous.input_hash === inputHash) {
    if (previous.status === 'ok') {
      return { topicId, status: 'ok', angleCount: threads.length, gapCount: 0, error: null };
    }
    // 阶段 A 已成功、阶段 B 失败：只重跑 B，不再花一次阶段 A 的 token。
    if (previous.status === 'partial' && previousResult && previousResult.phaseBStatus !== 'ok') {
      const phaseA = toPhaseA(previousResult);
      if (phaseA) {
        return runPhaseB({
          topicId,
          dbTopic,
          keywords,
          matrix,
          packed: packedB,
          members,
          threads,
          inputHash,
          phaseA,
          paradigmDomains,
          crossTopicGaps,
        });
      }
    }
  }

  log.info(
    {
      topicId,
      chars: packed.chars,
      evidence: packed.evidenceByArticleId.size,
      truncated: packed.truncated,
    },
    describePackedInput(packed)
  );

  const allowedArticleIds = new Set(members.map((member) => member.articleId));

  try {
    const phaseAResult = await synthesizeSynthesis({
      userId: dbTopic.user_id,
      topicName: dbTopic.name,
      topicKeywords: keywords,
      statsText: packed.statsText,
      threadsJson: packed.threadsJson,
      matrixSummary: packed.matrixSummary,
      changeContext: packed.changeContext,
      allowedArticleIds,
      evidenceByArticleId: packed.evidenceByArticleId,
      anglePatterns: packed.anglePatterns,
    });

    // 阶段 A 立即落库：阶段 B 失败不会让整轮综述白干。
    let phaseA = phaseAResult;
    if (!phaseA.overview && previousResult?.overview) {
      phaseA = { ...phaseA, overview: previousResult.overview };
    }
    const partial = mergeAnalysisResult(phaseA, null, 'pending');
    await persistAnalysis(topicId, members.length, matrix, inputHash, 'partial', null, partial);
    await applyAngleNarratives(threads, partial);

    return runPhaseB({
      topicId,
      dbTopic,
      keywords,
      matrix,
      packed: packedB,
      members,
      threads,
      inputHash,
      phaseA,
      paradigmDomains,
      crossTopicGaps,
    });
  } catch (error) {
    return markFailed(topicId, members.length, matrix, inputHash, previous, error);
  }
}

/* ── 阶段 B ── */

async function runPhaseB(args: {
  topicId: number;
  dbTopic: NonNullable<Awaited<ReturnType<typeof getTopicById>>>;
  keywords: string[];
  matrix: ReturnType<typeof buildMatrix>;
  packed: PackedAnalysisInput;
  members: Awaited<ReturnType<typeof loadTopicMembers>>['members'];
  threads: Awaited<ReturnType<typeof listThreads>>;
  inputHash: string;
  phaseA: PhaseAResult;
  paradigmDomains: ParadigmDomain[];
  crossTopicGaps: CrossTopicGap[];
}): Promise<AnalysisRunResult> {
  try {
    const phaseB = await synthesizeParadigms({
      userId: args.dbTopic.user_id,
      topicName: args.dbTopic.name,
      topicKeywords: args.keywords,
      statsText: args.packed.statsText,
      threadsJson: args.packed.threadsJson,
      matrixSummary: args.packed.matrixSummary,
      changeContext: args.packed.changeContext,
      allowedArticleIds: new Set([
        ...args.members.map((member) => member.articleId),
        ...args.crossTopicGaps.flatMap((gap) => gap.evidenceArticleIds),
      ]),
      evidenceByArticleId: args.packed.evidenceByArticleId,
      anglePatterns: args.packed.anglePatterns,
      synthesis: args.phaseA.synthesis,
      crossTopicGaps: args.crossTopicGaps,
      paradigmDomains: args.paradigmDomains,
    });

    const result = mergeAnalysisResult(args.phaseA, phaseB, 'ok');
    await persistAnalysis(
      args.topicId,
      args.members.length,
      args.matrix,
      args.inputHash,
      'ok',
      null,
      result
    );
    await applyAngleNarratives(args.threads, result);

    return {
      topicId: args.topicId,
      status: 'ok',
      angleCount: result.angles.length,
      gapCount: result.gaps.length,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = mergeAnalysisResult(args.phaseA, null, 'failed');
    await persistAnalysis(
      args.topicId,
      args.members.length,
      args.matrix,
      args.inputHash,
      'partial',
      `phase_b: ${message}`,
      failed
    );

    log.warn(
      { topicId: args.topicId, error: message },
      '阶段 B 失败，保留阶段 A 综述；下一轮只重跑阶段 B'
    );

    return {
      topicId: args.topicId,
      status: 'partial',
      angleCount: failed.angles.length,
      gapCount: 0,
      error: message,
    };
  }
}

/* ── 落库与失败 ── */

async function persistAnalysis(
  topicId: number,
  linkedCount: number,
  matrix: ReturnType<typeof buildMatrix>,
  inputHash: string,
  status: AnalysisStatus,
  errorMessage: string | null,
  analysis: AnalysisResult
): Promise<void> {
  await upsertTopicAnalysis({
    topicId,
    analysisJson: JSON.stringify(analysis),
    matrixJson: JSON.stringify(matrix),
    inputHash,
    linkedCount,
    contractVersion: CLUSTER_CONFIG.facetContractVersion,
    status,
    errorMessage,
  });
}

async function markFailed(
  topicId: number,
  linkedCount: number,
  matrix: ReturnType<typeof buildMatrix>,
  inputHash: string,
  previous: Awaited<ReturnType<typeof getTopicAnalysis>>,
  error: unknown
): Promise<AnalysisRunResult> {
  const message = error instanceof Error ? error.message : String(error);
  const severity = error instanceof ClusterSchemaError ? '已被 schema 校验拒收' : '调用失败';
  log.warn({ topicId, error: message }, `主题分析${severity}，保留上一次结果`);

  // 阶段 A 失败：保留旧结果，不写空内容。
  await persistAnalysis(
    topicId,
    linkedCount,
    matrix,
    inputHash,
    'failed',
    message,
    previous ? parseStoredResult(previous.analysis_json) ?? emptyAnalysisResult() : emptyAnalysisResult()
  );

  return { topicId, status: 'failed', angleCount: 0, gapCount: 0, error: message };
}

/* ── 输入指纹与回填 ── */

function computeInputHash(input: {
  topicId: number;
  name: string;
  memberIds: number[];
  facetTexts: string[];
  angleKeys: string[];
  representativeIds: number[];
}): string {
  const hash = createHash('sha256');
  // v2 分析契约上线后旧缓存必须失效，否则会跳过两阶段重算。
  hash.update(`contract:v2|topic:${input.topicId}|name:${input.name}`);
  hash.update(`|facet:${CLUSTER_CONFIG.facetContractVersion}`);
  hash.update(`|members:${input.memberIds.join(',')}`);
  hash.update(`|angles:${input.angleKeys.join(',')}`);
  hash.update(`|representatives:${input.representativeIds.join(',')}`);
  for (const text of input.facetTexts) hash.update(`|${text}`);
  return hash.digest('hex');
}

function buildFacetSignature(member: {
  articleId: number;
  facet: { research_question: string; method: string; study_object: string; core_finding: string };
}): string {
  return [
    member.articleId,
    member.facet.research_question,
    member.facet.method,
    member.facet.study_object,
    member.facet.core_finding,
  ].join('\u0001');
}

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

/* ── 旧结果读取 ── */

function parseStoredResult(raw: string | null | undefined): AnalysisResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AnalysisResult>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.synthesis) {
      // v1 缓存没有 synthesis：保留旧 fields，避免阶段 A 失败时把旧结果覆盖成空。
      return {
        ...emptyAnalysisResult(),
        overview: typeof parsed.overview === 'string' ? parsed.overview : '',
        angles: Array.isArray(parsed.angles) ? parsed.angles : [],
        trend: parsed.trend ?? { summary: '', direction: 'flat', evidenceArticleIds: [] },
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
        consensus: Array.isArray(parsed.consensus) ? parsed.consensus : [],
        controversies: Array.isArray(parsed.controversies) ? parsed.controversies : [],
        historySummary: typeof parsed.historySummary === 'string' ? parsed.historySummary : null,
      };
    }
    return {
      ...(parsed as AnalysisResult),
      phaseBStatus: parsed.phaseBStatus ?? 'pending',
    };
  } catch {
    return null;
  }
}

function toPhaseA(result: AnalysisResult): PhaseAResult | null {
  if (!result.synthesis || !Array.isArray(result.angles)) return null;
  return {
    overview: result.overview ?? '',
    synthesis: result.synthesis as AnalysisSynthesis,
    angles: result.angles,
    trend: result.trend ?? { summary: '', direction: 'flat', evidenceArticleIds: [] },
  };
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
