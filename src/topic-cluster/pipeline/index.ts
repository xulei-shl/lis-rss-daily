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
import { CLUSTER_CONFIG, CLUSTER_LIMITS } from '../config.js';
import { currentModel } from '../embedding.js';
import { refreshTopicCounts } from '../repo/links.js';
import { getTopicById, markTopicDirty, resetPeriodAddedCount } from '../repo/topics.js';
import { consolidateSmallTopics, type ConsolidationResult } from '../service/consolidation.js';
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
import { runPendingReviews, type ReviewStepResult } from './review.js';
import { runInsightStep, type InsightStepResult } from './insight.js';
import { countReviewsByTopic } from '../repo/reviews.js';
import { runDeriveForDirtyTopics, type DeriveResult } from './derive.js';
import { runIncubation, type IncubationResult } from './incubate.js';
import { runReclaim, type ReclaimResult } from './reclaim.js';
import { runIncrementalRouting, type RouteResult } from './route.js';
import {
  beginClusterRun,
  countLinksByTopic,
  diffTopicLinkCounts,
  finishClusterRun,
  type ClusterRunCounters,
  type ClusterRunTrigger,
  type FinishClusterRunInput,
} from '../repo/run-logs.js';

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
  consolidation: ConsolidationResult;
  reclaim: ReclaimResult;
  derive: DeriveResult;
  analysis: AnalysisStepResult;
  review: ReviewStepResult;
  insight: InsightStepResult;
}

export interface RunPipelineOptions {
  /** 单轮切面抽取的文章上限（防单轮过长，剩余下一轮继续） */
  facetLimit?: number;
  /** 单轮分析的主题上限 */
  analysisLimit?: number;
  /** 单轮深度综述的主题上限 */
  reviewLimit?: number;
  /** 单轮主题内洞察报告上限（跨全部主题） */
  insightLimit?: number;
  /** 忽略指纹强制重算分析 */
  forceAnalysis?: boolean;
  /** 跳过定向回捞（仅调试用） */
  skipReclaim?: boolean;
  /** 在回捞之后立刻重算派生数据与（冷启动场景下可传 false，由调用方自己分轮） */
  skipAnalysis?: boolean;
  /** 执行日志的触发来源（默认 cron） */
  trigger?: ClusterRunTrigger;
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
  const { setVersion, drift } = await ensureActiveSet();

  return runWithLog(options.trigger ?? 'cron', setVersion, async () => {
    const startedAt = Date.now();

    // 周期新增计数只在每日轮次重置（冷启动会另开一轮，届时重新累计）
    await resetPeriodAddedCount(setVersion);

    const facets = await runFacetStep(options.facetLimit ?? 50);
    const routing = await runIncrementalRouting({ userId: CLUSTER_CONFIG.userId, setVersion });
    const incubation = await runIncubation({ userId: CLUSTER_CONFIG.userId, setVersion });

    // 孵化后先整合样本不足的微主题，避免回捞把它们重新拉成散装主题。
    const consolidation = await consolidateSmallTopics(setVersion);

    // 新主题在孵化时只是 NEW 且无计数，这里统一补齐计数与脏标记；
    // 若某个新主题在整合中被并入其他主题，则不再刷新已删除主题。
    for (const topicId of incubation.createdTopicIds) {
      const topic = await getTopicById(topicId);
      if (!topic) continue;
      await refreshTopicCounts(topicId);
      await markTopicDirty(topicId);
    }

    const reclaim = options.skipReclaim
      ? emptyReclaimResult()
      : await runReclaim({
          userId: CLUSTER_CONFIG.userId,
          setVersion,
          newTopicIds: incubation.createdTopicIds.filter(
            (topicId) => consolidation.removedTopicIds.indexOf(topicId) === -1
          ),
        });

    const derive = await runDeriveForDirtyTopics(setVersion);

    const analysis = options.skipAnalysis
      ? emptyAnalysisStepResult()
      : await runPendingAnalyses(setVersion, {
          limit: options.analysisLimit ?? 20,
          force: options.forceAnalysis,
        });

    // 深度综述与洞察只在做分析的轮次里跟进，避免日调度把旗舰模型成本翻倍。
    const review = options.skipAnalysis
      ? emptyReviewStepResult()
      : await runPendingReviews(setVersion, {
          limit: options.reviewLimit ?? 10,
          force: options.forceAnalysis,
        });
    // 综述还有积压时先生成综述，避免用半套节点产出很快会过期的洞察报告。
    const insight =
      options.skipAnalysis || review.backlog > 0
        ? emptyInsightStepResult()
        : await runInsightStep(setVersion, {
            limit: options.insightLimit,
            force: options.forceAnalysis,
          });

    const summary: ClusterRunSummary = { setVersion, drift, facets, routing, incubation, consolidation, reclaim, derive, analysis, review, insight };

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
        reviews: review.created + review.updated,
        insights: insight.created + insight.updated,
      },
      '主题聚类流水线完成'
    );

    return {
      result: summary,
      counters: {
        facetSucceeded: facets.succeeded,
        facetFailed: facets.failed,
        routedArticles: routing.routedArticles,
        newTopics: incubation.createdTopicIds.length,
        reclaimedLinks: reclaim.reclaimedLinks,
        analyzedTopics: analysis.ok,
        reviewedTopics: review.ok + review.partial,
        newReviews: review.created,
        insightReports: insight.created,
      },
    };
  });
}

/**
 * 冷启动：一次性为全部「有全文总结」的文章建切面并聚出初始主题集合。
 *
 * 实现上的关键简化：冷启动时**游离池就是全部文章**，
 * 因此直接复用「孵化」逻辑即可完成全量聚类，不需要另写一套全量聚类代码。
 * 回捞在冷启动阶段必然无收益（无已归属文章），故跳过。
 */
export async function runColdStart(
  options: {
    facetBatchSize?: number;
    analysisLimit?: number;
    skipAnalysis?: boolean;
    trigger?: Extract<ClusterRunTrigger, 'cold_start' | 'rebuild'>;
  } = {}
): Promise<ClusterRunSummary> {
  const { setVersion, drift } = await ensureActiveSet();

  return runWithLog(options.trigger ?? 'cold_start', setVersion, async () => {
    const startedAt = Date.now();
    await resetPeriodAddedCount(setVersion);

    // 冷启动要抽完所有历史文章（817 篇量级），分批以控制单次任务时长
    const facets = await runFacetStep(options.facetBatchSize ?? 2000);

    const routing = await runIncrementalRouting({ userId: CLUSTER_CONFIG.userId, setVersion });
    const incubation = await runIncubation({ userId: CLUSTER_CONFIG.userId, setVersion });

    for (const topicId of incubation.createdTopicIds) {
      const topic = await getTopicById(topicId);
      if (!topic) continue;
      await refreshTopicCounts(topicId);
      await markTopicDirty(topicId);
    }

    const consolidation = await consolidateSmallTopics(setVersion);

    const derive = await runDeriveForDirtyTopics(setVersion);
    // 跳过分析时保留 is_dirty，之后跑一次每日流水线或重新执行冷启动即可补齐
    const analysis = options.skipAnalysis
      ? emptyAnalysisStepResult()
      : await runPendingAnalyses(setVersion, {
          limit: options.analysisLimit ?? 200,
          force: true,
        });
    const review = options.skipAnalysis
      ? emptyReviewStepResult()
      : await runPendingReviews(setVersion, { limit: 200, force: true });
    const insight =
      options.skipAnalysis || review.backlog > 0
        ? emptyInsightStepResult()
        : await runInsightStep(setVersion, { force: true });

    log.info(
      {
        setVersion,
        elapsedMs: Date.now() - startedAt,
        topics: incubation.createdTopicIds.length,
        noise: incubation.remainingPoolSize,
        analyses: analysis.ok,
        reviews: review.created + review.updated,
        insights: insight.created + insight.updated,
      },
      '冷启动完成'
    );

    return {
      result: {
        setVersion,
        drift,
        facets,
        routing,
        incubation,
        consolidation,
        reclaim: emptyReclaimResult(),
        derive,
        analysis,
        review,
        insight,
      },
      counters: {
        facetSucceeded: facets.succeeded,
        facetFailed: facets.failed,
        routedArticles: routing.routedArticles,
        newTopics: incubation.createdTopicIds.length,
        reclaimedLinks: 0,
        analyzedTopics: analysis.ok,
        reviewedTopics: review.ok + review.partial,
        newReviews: review.created,
        insightReports: insight.created,
      },
    };
  });
}

/** 日派生：只重算脏主题的脉络与指标，不调用 LLM。forceAll 用于 schema 升级后全量回填。 */
export async function runScheduledDerive(
  options: { forceAll?: boolean } = {}
): Promise<{ setVersion: number; derive: DeriveResult }> {
  const { setVersion } = await ensureActiveSet();
  const derive = await runDeriveForDirtyTopics(setVersion, options);
  return { setVersion, derive };
}

/**
 * 周分析：脏主题的两阶段分析 → 深度综述 → 主题内洞察。
 *
 * 三步写在同一轮执行日志里，页面能看到每周实际生成了多少综述与洞察。
 */
export async function runScheduledAnalyses(
  options: {
    limit?: number;
    force?: boolean;
    reviewLimit?: number;
    insightLimit?: number;
    skipReview?: boolean;
    skipInsight?: boolean;
  } = {}
): Promise<AnalysisStepResult> {
  const { setVersion } = await ensureActiveSet();

  return runWithLog('cron', setVersion, async () => {
    const analysis = await runPendingAnalyses(setVersion, {
      limit: options.limit ?? 200,
      force: options.force,
    });
    const review = options.skipReview
      ? emptyReviewStepResult()
      : await runPendingReviews(setVersion, {
          limit: options.reviewLimit ?? CLUSTER_LIMITS.reviewWeeklyLimit,
          force: options.force,
        });
    const insight =
      options.skipInsight || review.backlog > 0
        ? emptyInsightStepResult()
        : await runInsightStep(setVersion, {
            limit: options.insightLimit,
            force: options.force,
          });

    return {
      result: analysis,
      counters: {
        facetSucceeded: 0,
        facetFailed: 0,
        routedArticles: 0,
        newTopics: 0,
        reclaimedLinks: 0,
        analyzedTopics: analysis.ok,
        reviewedTopics: review.ok + review.partial,
        newReviews: review.created,
        insightReports: insight.created,
      },
    };
  });
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

/**
 * 包一层执行日志：进入前记录基线链接数，退出后记录耗时、计数与按主题增量。
 *
 * 日志是旁路能力，任何日志写入失败都只告警，不影响流水线本身的结果与异常传播。
 */
async function runWithLog<T>(
  trigger: ClusterRunTrigger,
  setVersion: number,
  execute: () => Promise<{ result: T; counters: ClusterRunCounters }>
): Promise<T> {
  const startedAt = Date.now();

  let runId: number;
  try {
    runId = await beginClusterRun({ userId: CLUSTER_CONFIG.userId, setVersion, trigger });
  } catch (error) {
    log.warn({ error: errorMessage(error) }, '写入执行日志失败，本轮跳过日志记录');
    return (await execute()).result;
  }

  const before = await countLinksByTopic(setVersion).catch((error) => {
    log.warn({ error: errorMessage(error) }, '读取主题链接基线失败，本轮不记录按主题增量');
    return new Map<number, number>();
  });
  const beforeReviews = await countReviewsByTopic(setVersion).catch(() => new Map<number, number>());

  try {
    const { result, counters } = await execute();
    const after = await countLinksByTopic(setVersion).catch(() => new Map<number, number>());
    const afterReviews = await countReviewsByTopic(setVersion).catch(() => new Map<number, number>());
    await safeFinishRun(runId, {
      status: 'completed',
      durationMs: Date.now() - startedAt,
      counters,
      topicDeltas: diffTopicLinkCounts(before, after),
      reviewDeltas: diffTopicLinkCounts(beforeReviews, afterReviews),
    });
    return result;
  } catch (error) {
    await safeFinishRun(runId, {
      status: 'failed',
      durationMs: Date.now() - startedAt,
      errorMessage: errorMessage(error),
    });
    throw error;
  }
}

async function safeFinishRun(runId: number, input: FinishClusterRunInput): Promise<void> {
  try {
    await finishClusterRun(runId, input);
  } catch (error) {
    log.warn({ runId, error: errorMessage(error) }, '更新执行日志失败');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyReclaimResult(): ReclaimResult {
  return { scannedArticles: 0, reclaimedLinks: 0, reclaimedArticles: 0, dirtyTopicIds: [] };
}

function emptyAnalysisStepResult(): AnalysisStepResult {
  return { attempted: 0, ok: 0, partial: 0, insufficient: 0, failed: 0, failures: [] };
}

function emptyReviewStepResult(): ReviewStepResult {
  return {
    attempted: 0,
    ok: 0,
    partial: 0,
    skipped: 0,
    failed: 0,
    created: 0,
    updated: 0,
    backlog: 0,
    failures: [],
  };
}

function emptyInsightStepResult(): InsightStepResult {
  return { status: 'skipped', clusters: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
}

export function isClusterEnabled(): boolean {
  return CLUSTER_CONFIG.enabled;
}
