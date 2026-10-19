/**
 * 主题聚类流水线编排。
 *
 * 位置说明（设计文档 §5）：这是本模块的顶层编排，被调度器与命令行脚本共同调用；
 * 每一步都在同目录下的独立文件里，本文件只负责顺序、共享状态与汇总。
 *
 * 六步顺序（顺序不可调换）：
 *   ① 切面抽取   全文总结 → 切面 + 向量
 *   ② 增量路由   游离文章 → 既有主题（多归属）
 *   ③ 游离池孵化 游离池 → 新主题
 *   ④ 定向回捞   新主题质心 → 追加已归属文章（修补新主题先天不全）
 *   ⑤ 派生重算   脏主题的簇内脉络 + 周期指标
 *   ⑥ 多维分析   脏主题的 LLM 叙述（失败保留脏标记，下轮重试）
 */

import { logger } from '../../logger.js';
import { CLUSTER_CONFIG } from '../config.js';
import { currentModel } from '../embedding.js';
import { refreshTopicCounts } from '../repo/links.js';
import { markTopicDirty, resetPeriodAddedCount } from '../repo/topics.js';
import {
  archiveSet,
  createSet,
  detectConfigDrift,
  getActiveSet,
  nextSetVersion,
  type ConfigDrift,
} from '../repo/sets.js';
import { buildFacetsForArticles } from '../service/facet-builder.js';
import { countFacetSourceArticles, listFacetSourceArticles } from '../source.js';
import { runPendingAnalyses, type AnalysisStepResult } from './analyze.js';
import { runDeriveForDirtyTopics, type DeriveResult } from './derive.js';
import { runIncubation, type IncubationResult } from './incubate.js';
import { runReclaim, type ReclaimResult } from './reclaim.js';
import { runIncrementalRouting, type RouteResult } from './route.js';

const log = logger.child({ module: 'topic-cluster/pipeline' });

export interface FacetStepSummary {
  requested: number;
  succeeded: number;
  failed: number;
  skippedExisting: number;
}

export interface ClusterRunSummary {
  setVersion: number;
  drift: ConfigDrift;
  facets: FacetStepSummary;
  routing: RouteResult;
  incubation: IncubationResult;
  reclaim: ReclaimResult;
  derive: DeriveResult;
  analysis: AnalysisStepResult;
}

export interface RunPipelineOptions {
  /** 单轮切面抽取的文章上限（防单轮过长，剩余下一轮继续） */
  facetLimit?: number;
  /** 单轮分析的主题上限 */
  analysisLimit?: number;
  /** 忽略指纹强制重算分析 */
  forceAnalysis?: boolean;
  /** 跳过定向回捞（仅调试用） */
  skipReclaim?: boolean;
  /** 在回捞之后立刻重算派生数据与（冷启动场景下可传 false，由调用方自己分轮） */
  skipAnalysis?: boolean;
}

/**
 * 确保存在 active 主题集合版本；不存在则创建 v1。
 *
 * 同时做配置漂移检测——**只告警、不自动重建**（设计文档 §7.9：
 * 重建是重操作，会替换整套主题身份，必须人工确认）。
 */
export async function ensureActiveSet(): Promise<{
  setVersion: number;
  created: boolean;
  drift: ConfigDrift;
}> {
  const active = await getActiveSet(CLUSTER_CONFIG.userId);

  if (active) {
    const drift = detectConfigDrift(active);
    if (drift.drifted) {
      log.warn(
        { setVersion: active.version, reasons: drift.reasons },
        '主题集合与当前配置不一致，建议执行重建（本模块不会自动重建）'
      );
    }
    return { setVersion: active.version, created: false, drift };
  }

  const version = await nextSetVersion();
  const model = await currentModel(CLUSTER_CONFIG.userId);
  await createSet({
    version,
    triggerReason: 'init',
    embeddingModel: model,
    embeddingDim: CLUSTER_CONFIG.embeddingDim,
    facetContractVersion: CLUSTER_CONFIG.facetContractVersion,
    initThreshold: CLUSTER_CONFIG.initThreshold,
    note: '自动创建首个主题集合版本',
  });

  log.info({ version, model }, '创建主题集合版本 v' + version);
  return { setVersion: version, created: true, drift: { drifted: false, reasons: [] } };
}

export interface FacetBackfillOptions {
  /** 本轮最多处理多少篇（默认 200） */
  limit?: number;
  /** 仅处理指定文章（小样本抽检用） */
  articleIds?: number[];
}

export interface FacetBackfillResult extends FacetStepSummary {
  /** 本轮结束后仍待抽取的篇数（用于分批推进） */
  remaining: number;
  failures: Array<{ articleId: number; error: string }>;
}

/**
 * 步骤 ①：抽取切面（可独立分批执行）。
 *
 * 已经抽过的文章在 SQL 层被排除，因此**反复调用同一个 limit 会自然向前推进**，
 * 这让「先抽 30 篇看质量 → 满意后再全量」成为可行的稳妥路径。
 *
 * 聚类本身是纯代码、零 token、秒级完成，因此分批只需针对本步骤；
 * 把聚类也拆开跑只会得到更差的主题结构（早期文章先占坑，后续无法回溯重聚）。
 */
export async function runFacetBackfill(
  options: FacetBackfillOptions = {}
): Promise<FacetBackfillResult> {
  const userId = CLUSTER_CONFIG.userId;
  const articles = await listFacetSourceArticles(userId, {
    limit: options.limit ?? 200,
    articleIds: options.articleIds,
  });
  const summary = await buildFacetsForArticles(articles, userId);

  return {
    requested: summary.requested,
    succeeded: summary.succeeded,
    failed: summary.failed,
    skippedExisting: summary.skippedExisting,
    remaining: await countFacetSourceArticles(userId),
    failures: summary.outcomes
      .filter((item) => item.status === 'failed')
      .map((item) => ({ articleId: item.articleId, error: item.error ?? '未知错误' })),
  };
}

/** 步骤 ①：每日增量（在整条流水线内的调用形式） */
async function runFacetStep(limit: number): Promise<FacetStepSummary> {
  const result = await runFacetBackfill({ limit });
  return {
    requested: result.requested,
    succeeded: result.succeeded,
    failed: result.failed,
    skippedExisting: result.skippedExisting,
  };
}

/** 每日增量：一轮完整的六步 */
export async function runClusterPipeline(
  options: RunPipelineOptions = {}
): Promise<ClusterRunSummary> {
  const startedAt = Date.now();
  const { setVersion, drift } = await ensureActiveSet();

  // 周期新增计数只在每日轮次重置（冷启动会另开一轮，届时重新累计）
  await resetPeriodAddedCount(setVersion);

  const facets = await runFacetStep(options.facetLimit ?? 50);
  const routing = await runIncrementalRouting({ userId: CLUSTER_CONFIG.userId, setVersion });
  const incubation = await runIncubation({ userId: CLUSTER_CONFIG.userId, setVersion });

  const reclaim = options.skipReclaim
    ? emptyReclaimResult()
    : await runReclaim({
        userId: CLUSTER_CONFIG.userId,
        setVersion,
        newTopicIds: incubation.createdTopicIds,
      });

  // 新主题在孵化时只是 NEW 且无计数，这里统一补齐计数与脏标记
  for (const topicId of incubation.createdTopicIds) {
    await refreshTopicCounts(topicId);
    await markTopicDirty(topicId);
  }

  const derive = await runDeriveForDirtyTopics(setVersion);

  const analysis = options.skipAnalysis
    ? emptyAnalysisStepResult()
    : await runPendingAnalyses(setVersion, {
        limit: options.analysisLimit ?? 20,
        force: options.forceAnalysis,
      });

  const summary: ClusterRunSummary = { setVersion, drift, facets, routing, incubation, reclaim, derive, analysis };

  log.info(
    {
      setVersion,
      elapsedMs: Date.now() - startedAt,
      facets: facets.succeeded,
      routed: routing.routedArticles,
      newTopics: incubation.createdTopicIds.length,
      reclaimed: reclaim.reclaimedLinks,
      analyses: analysis.ok,
      failedAnalyses: analysis.failed,
    },
    '主题聚类流水线完成'
  );

  return summary;
}

/**
 * 冷启动：一次性为全部「有全文总结」的文章建切面并聚出初始主题集合。
 *
 * 实现上的关键简化：冷启动时**游离池就是全部文章**，
 * 因此直接复用「孵化」逻辑即可完成全量聚类，不需要另写一套全量聚类代码。
 * 回捞在冷启动阶段必然无收益（无已归属文章），故跳过。
 */
export async function runColdStart(
  options: { facetBatchSize?: number; analysisLimit?: number; skipAnalysis?: boolean } = {}
): Promise<ClusterRunSummary> {
  const startedAt = Date.now();
  const { setVersion, drift } = await ensureActiveSet();
  await resetPeriodAddedCount(setVersion);

  // 冷启动要抽完所有历史文章（817 篇量级），分批以控制单次任务时长
  const facets = await runFacetStep(options.facetBatchSize ?? 2000);

  const routing = await runIncrementalRouting({ userId: CLUSTER_CONFIG.userId, setVersion });
  const incubation = await runIncubation({ userId: CLUSTER_CONFIG.userId, setVersion });

  for (const topicId of incubation.createdTopicIds) {
    await refreshTopicCounts(topicId);
    await markTopicDirty(topicId);
  }

  const derive = await runDeriveForDirtyTopics(setVersion);
  // 跳过分析时保留 is_dirty，之后跑一次每日流水线或重新执行冷启动即可补齐
  const analysis = options.skipAnalysis
    ? emptyAnalysisStepResult()
    : await runPendingAnalyses(setVersion, {
        limit: options.analysisLimit ?? 200,
        force: true,
      });

  log.info(
    {
      setVersion,
      elapsedMs: Date.now() - startedAt,
      topics: incubation.createdTopicIds.length,
      noise: incubation.remainingPoolSize,
      analyses: analysis.ok,
    },
    '冷启动完成'
  );

  return {
    setVersion,
    drift,
    facets,
    routing,
    incubation,
    reclaim: emptyReclaimResult(),
    derive,
    analysis,
  };
}

/**
 * 重建主题集合：归档当前版本并创建新版本。
 *
 * 调用方（scripts/cluster-rebuild.ts，或未来的管理入口）需明确知道：
 * 旧版本数据**全部保留**，旧 slug 不做迁移，前端需按 set_version 查询。
 */
export async function startNewSetVersion(triggerReason: string): Promise<number> {
  const active = await getActiveSet(CLUSTER_CONFIG.userId);
  if (active) await archiveSet(active.version);

  const version = await nextSetVersion();
  const model = await currentModel(CLUSTER_CONFIG.userId);
  await createSet({
    version,
    triggerReason,
    embeddingModel: model,
    embeddingDim: CLUSTER_CONFIG.embeddingDim,
    facetContractVersion: CLUSTER_CONFIG.facetContractVersion,
    initThreshold: CLUSTER_CONFIG.initThreshold,
    note: `由 ${triggerReason} 触发的重建`,
  });

  log.warn({ from: active?.version ?? null, to: version, triggerReason }, '已切换到新的主题集合版本');
  return version;
}

function emptyReclaimResult(): ReclaimResult {
  return { scannedArticles: 0, reclaimedLinks: 0, reclaimedArticles: 0, dirtyTopicIds: [] };
}

function emptyAnalysisStepResult(): AnalysisStepResult {
  return { attempted: 0, ok: 0, insufficient: 0, failed: 0, failures: [] };
}

export function isClusterEnabled(): boolean {
  return CLUSTER_CONFIG.enabled;
}
