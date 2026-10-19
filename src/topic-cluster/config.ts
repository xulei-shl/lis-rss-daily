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

/** 环境变量驱动的配置（只读快照） */
export const CLUSTER_CONFIG = Object.freeze({
  enabled: appConfig.clusterEnabled,
  schedule: appConfig.clusterSchedule,
  userId: appConfig.clusterUserId,
  scope: appConfig.clusterScope,

  simThreshold: appConfig.clusterSimThreshold,
  initThreshold: appConfig.clusterInitThreshold,
  reclaimThreshold: appConfig.clusterReclaimThreshold,
  angleThreshold: appConfig.clusterAngleThreshold,
  chainThreshold: appConfig.clusterChainThreshold,
  strongThreshold: appConfig.clusterStrongThreshold,

  minPoolSize: appConfig.clusterMinPoolSize,
  minClusterSize: appConfig.clusterMinClusterSize,
  maxTopicsPerArticle: appConfig.clusterMaxTopicsPerArticle,
  minTrendSamples: appConfig.clusterMinTrendSamples,
  dormantDays: appConfig.clusterDormantDays,
  llmConcurrency: appConfig.clusterLlmConcurrency,
  embeddingDim: appConfig.clusterEmbeddingDim,
  facetContractVersion: appConfig.clusterFacetContractVersion,
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
});

/** 多维分析落库状态（设计文档 §7.7） */
export type AnalysisStatus = 'ok' | 'insufficient_data' | 'failed';

/** 模块内部规则常量（规则层调优，不暴露为环境变量） */
export const CLUSTER_LIMITS = Object.freeze({
  /** 单主题最多角度数，超出后合并最相近角度 */
  maxAngleCount: 6,
  /** 角度内至少 2 篇才算一个独立角度 */
  minAngleSize: 2,
  /** 脉络最少篇数，低于此归入「零散研究」，不生成叙述 */
  minThreadLength: 3,
  /** 相邻承接率下限，低于此该角度降级为零散研究（避免把「只是语义相近」当演进） */
  minContinuityRatio: 0.5,
  /** 低于此文章数不生成多维分析（走 insufficient_data 降级） */
  minArticlesForAnalysis: 6,
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
});
