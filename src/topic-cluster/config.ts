/**
 * 主题聚类模块的配置聚合点。
 *
 * 职责边界：
 *   - 环境变量配置统一定义在 `src/config.ts`，本文件只做只读聚合，方便模块内统一取值；
 *   - 模块内部规则常量（不进 .env，避免配置膨胀）放在 `CLUSTER_LIMITS`。
 *
 * 注意：所有阈值均为初始值，必须按设计文档 §14.3 的校准流程实测后固化。
 */

import { config as appConfig } from '../config.js';

/**
 * 字符/token 的保守换算。中文 1 字通常 1~1.5 token，这里按 1 token≈0.8 字
 * 预留安全余量，避免输入估算过小导致 context 超限。
 */
const CHARS_PER_TOKEN = 0.8;
/** Prompt 模板、JSON 包装与角色说明的固定开销 */
const PROMPT_OVERHEAD_TOKENS = 2_000;

const analysisContextTokens = appConfig.clusterAnalysisContextTokens;
const analysisOutputTokens = Math.min(
  appConfig.clusterAnalysisOutputTokens,
  Math.max(analysisContextTokens - PROMPT_OVERHEAD_TOKENS, 1_024)
);
const computedInputChars = Math.floor(
  Math.max(analysisContextTokens - analysisOutputTokens - PROMPT_OVERHEAD_TOKENS, 1_024) *
    CHARS_PER_TOKEN
);
const analysisInputCharBudget =
  appConfig.clusterAnalysisInputChars ?? computedInputChars;

/** 环境变量驱动的配置（只读快照） */
export const CLUSTER_CONFIG = Object.freeze({
  enabled: appConfig.clusterEnabled,
  schedule: appConfig.clusterSchedule,
  analysisSchedule: appConfig.clusterAnalysisSchedule,
  userId: appConfig.clusterUserId,
  scope: appConfig.clusterScope,

  simThreshold: appConfig.clusterSimThreshold,
  initThreshold: appConfig.clusterInitThreshold,
  reclaimThreshold: appConfig.clusterReclaimThreshold,
  angleThreshold: appConfig.clusterAngleThreshold,
  subtopicThreshold: appConfig.clusterAngleThreshold,
  chainThreshold: appConfig.clusterChainThreshold,
  strongThreshold: appConfig.clusterStrongThreshold,

  minPoolSize: appConfig.clusterMinPoolSize,
  minClusterSize: appConfig.clusterMinClusterSize,
  maxTopicsPerArticle: appConfig.clusterMaxTopicsPerArticle,

  /** 周期归属再平衡的迟滞带宽度（既有链接保留线 = simThreshold - margin） */
  rebalanceMargin: appConfig.clusterRebalanceMargin,
  /** 每日切面抽取总量上限（分批拉满） */
  facetMaxPerRun: appConfig.clusterFacetMaxPerRun,
  /** 切面积压告警阈值 */
  facetBacklogAlert: appConfig.clusterFacetBacklogAlert,
  minTrendSamples: appConfig.clusterMinTrendSamples,
  dormantDays: appConfig.clusterDormantDays,
  llmConcurrency: appConfig.clusterLlmConcurrency,
  embeddingDim: appConfig.clusterEmbeddingDim,
  facetContractVersion: appConfig.clusterFacetContractVersion,

  /** 分析输入字符预算：由上下文窗口 - 输出上限 - Prompt 开销换算 */
  analysisInputCharBudget,
  /** 阶段 A 输出上限；阶段 B 用完整输出预算 */
  analysisPhaseATokens: Math.min(8_192, analysisOutputTokens),
  analysisPhaseBTokens: analysisOutputTokens,

  /** 深度综述输入预算：与主题分析共用同一套字符预算换算 */
  reviewInputCharBudget: analysisInputCharBudget,
  /** 单篇深度综述输出上限 */
  reviewOutputTokens: analysisOutputTokens,
  /** 单个子主题独立空白分析输出上限 */
  subtopicGapsOutputTokens: Math.min(4_096, analysisOutputTokens),
  /** 主题内洞察报告输出上限 */
  insightOutputTokens: analysisOutputTokens,
});

/**
 * 本模块使用的 LLM 任务类型。
 *
 * 三者共用现有 `getUserLLMProvider(userId, taskType)`，可在 /settings 的 LLM 配置里
 * 分别为它们指定不同模型（配置解析优先级：精确匹配 task_type > task_type 为空兜底）。
 */
export const CLUSTER_TASKS = Object.freeze({
  facet: 'cluster_facet',
  analysis: 'cluster_analysis',
  naming: 'cluster_naming',
  review: 'cluster_review',
  insight: 'cluster_insight',
});

/** 多维分析落库状态（设计文档 §7.7） */
export type AnalysisStatus = 'ok' | 'partial' | 'insufficient_data' | 'failed';

/** 模块内部规则常量（规则层调优，不暴露为环境变量） */
export const CLUSTER_LIMITS = Object.freeze({
  /** 单主题最多角度数（K_target 上限），超出后合并最相近角度 */
  maxAngleCount: 10,
  /** 连续承接段的最少篇数，低于此标记为并列子域，不生成时间演进 */
  minThreadLength: 3,
  /** 低于此文章数不生成多维分析（走 insufficient_data 降级） */
  minArticlesForAnalysis: 6,
  /** 微主题整合：小主题两两合并时的平均连接阈值 */
  smallTopicMergeThreshold: 0.8,
  /** 微主题整合：小主题被正式主题吸收时的相似度阈值 */
  smallTopicAbsorbThreshold: 0.82,
  /** 单次多维分析输入的最大篇数（防 prompt 过大） */
  maxArticlesPerAnalysisInput: 40,
  /** 对比矩阵中方法/对象各自的最低出现次数（低于此视为长尾噪声，不进矩阵） */
  matrixMinCount: 2,
  /** 单篇切面抽取输入 ai_summary 的截断长度 */
  facetInputMaxChars: 4000,
  /**
   * 参与切面抽取的全文总结最短长度。
   * 低于此值是测试/异常残留（实测全库仅 2 篇：26 与 128 字符），
   * 抽不出有意义的切面，只会白花 token 并污染聚类。
   */
  minFacetSummaryChars: 200,
  /** 趋势判定：后半段 / 前半段密度比的上限与下限 */
  trendUpRatio: 1.3,
  trendDownRatio: 0.7,
  /** 邻近空白判定：两个主题质心相似度阈值 */
  adjacentTopicThreshold: 0.72,
  /** 时效缺口判定：连续无新增的月数 */
  stalePeriods: 3,

  /** 深度综述：主题内二级聚类的平均连接阈值 */
  reviewClusterThreshold: 0.7,
  /** 深度综述：语义子课题的最小成员数（最少 2 篇成簇并支持综述） */
  reviewMinMembers: 2,
  /** 深度综述：单主题最多生成的子簇综述数 */
  reviewMaxGroups: 8,
  /** 深度综述：每篇综述最多携带的证据文献数 */
  reviewEvidenceCap: 18,
  /** 子主题独立空白分析：每个子主题最多产出的研究空白条数 */
  subtopicMaxGaps: 3,
  /** 深度综述：周分析单轮最多处理的主题数（控制旗舰模型成本） */
  reviewWeeklyLimit: 40,
  /** 主题内洞察：节点（综述子簇 + 空白）二次聚类的相似度阈值 */
  insightClusterThreshold: 0.66,
  /** 主题内洞察：元簇最少节点数 */
  insightMinNodes: 2,
  /** 主题内洞察：元簇至少包含的综述子簇数（纯空白簇不出报告） */
  insightMinReviews: 2,
  /** 主题内洞察：单主题最多生成的报告数 */
  insightMaxReports: 3,
  /** 主题内洞察：周分析单轮最多生成的报告数（跨全部主题，控制成本） */
  insightWeeklyLimit: 12,
  /** 主题内洞察：每份报告最多携带的综述/空白节点数 */
  insightEvidenceCap: 12,
  /** 主题内洞察：每份报告挂载的空白数量与成熟度评估上限 */
  insightGapCap: 16,
});
