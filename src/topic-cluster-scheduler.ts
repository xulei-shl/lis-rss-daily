/**
 * 主题聚类调度器。
 *
 * 位置：项目所有调度器都在 src/ 顶层（与 insights-scheduler 等一致），
 * 因此本文件放在顶层，而模块逻辑全部在 src/topic-cluster/ 下。
 *
 * 默认排在每日全文总结（07:00）与每日总结之后，避开 LLM 速率配额与 SQLite 写锁。
 */

import { logger } from './logger.js';
import { BaseScheduler } from './utils/base-scheduler.js';
import { config as appConfig } from './config.js';
import { CLUSTER_CONFIG } from './topic-cluster/config.js';
import { runClusterPipeline, type ClusterRunSummary } from './topic-cluster/pipeline/index.js';

const log = logger.child({ module: 'topic-cluster-scheduler' });

export interface TopicClusterSchedulerStatus {
  isRunning: boolean;
  enabled: boolean;
  schedule: string;
  lastRunTime?: Date;
  lastRunSummary?: ClusterRunSummary;
  lastRunError?: string;
}

export class TopicClusterScheduler extends BaseScheduler {
  private static instance: TopicClusterScheduler | null = null;

  private isExecuting = false;
  private stats: {
    lastRunTime?: Date;
    lastRunSummary?: ClusterRunSummary;
    lastRunError?: string;
  } = {};

  private constructor() {
    super();
  }

  get schedulerName(): string {
    return 'Topic cluster scheduler';
  }

  get cronSchedule(): string {
    return CLUSTER_CONFIG.schedule;
  }

  get isEnabled(): boolean {
    return CLUSTER_CONFIG.enabled;
  }

  get timezone(): string {
    return appConfig.defaultTimezone || 'Asia/Shanghai';
  }

  protected async run(): Promise<void> {
    if (this.isExecuting) {
      log.warn('上一轮主题聚类仍在执行，本次跳过');
      return;
    }

    this.isExecuting = true;
    this.stats.lastRunTime = new Date();

    try {
      const summary = await runClusterPipeline();
      this.stats.lastRunSummary = summary;
      this.stats.lastRunError = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stats.lastRunError = message;
      log.error({ error: message }, '主题聚类流水线执行失败');
    } finally {
      this.isExecuting = false;
    }
  }

  /** better-sqlite3 为同步驱动，等待在途写入完成，避免关闭时数据截断 */
  protected async waitForCompletion(): Promise<void> {
    if (!(await this.pollWhile(() => this.isExecuting, 300000))) {
      log.warn('关闭时主题聚类仍在执行，已强制退出');
    }
  }

  static getInstance(): TopicClusterScheduler {
    if (!TopicClusterScheduler.instance) {
      TopicClusterScheduler.instance = new TopicClusterScheduler();
    }
    return TopicClusterScheduler.instance;
  }

  getStatus(): TopicClusterSchedulerStatus {
    return {
      isRunning: this.isRunning,
      enabled: this.isEnabled,
      schedule: this.cronSchedule,
      lastRunTime: this.stats.lastRunTime,
      lastRunSummary: this.stats.lastRunSummary,
      lastRunError: this.stats.lastRunError,
    };
  }

  /** 手动立即执行一轮（供 API/脚本调用，不改变定时计划） */
  async runNow(): Promise<ClusterRunSummary> {
    log.info('手动触发主题聚类流水线');
    return runClusterPipeline({ forceAnalysis: false });
  }
}

export function initTopicClusterScheduler(): TopicClusterScheduler {
  return TopicClusterScheduler.getInstance();
}
