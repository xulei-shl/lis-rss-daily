/**
 * 主题综述周分析调度器。
 *
 * 日派生在 TopicClusterScheduler 中完成；本调度器只负责按周对 is_dirty=1 的主题
 * 跑两阶段综述，避免每天重复消耗旗舰模型。
 */

import { logger } from './logger.js';
import { BaseScheduler } from './utils/base-scheduler.js';
import { config as appConfig } from './config.js';
import { CLUSTER_CONFIG } from './topic-cluster/config.js';
import { runScheduledAnalyses } from './topic-cluster/pipeline/index.js';
import type { AnalysisStepResult } from './topic-cluster/pipeline/analyze.js';

const log = logger.child({ module: 'topic-analysis-scheduler' });

export class TopicAnalysisScheduler extends BaseScheduler {
  private static instance: TopicAnalysisScheduler | null = null;

  private isExecuting = false;
  private stats: {
    lastRunTime?: Date;
    lastRunSummary?: AnalysisStepResult;
    lastRunError?: string;
  } = {};

  private constructor() {
    super();
  }

  get schedulerName(): string {
    return 'Topic analysis scheduler';
  }

  get cronSchedule(): string {
    return CLUSTER_CONFIG.analysisSchedule;
  }

  get isEnabled(): boolean {
    return CLUSTER_CONFIG.enabled;
  }

  get timezone(): string {
    return appConfig.defaultTimezone || 'Asia/Shanghai';
  }

  protected async run(): Promise<void> {
    if (this.isExecuting) {
      log.warn('上一轮主题综述仍在执行，本次跳过');
      return;
    }

    this.isExecuting = true;
    this.stats.lastRunTime = new Date();

    try {
      const summary = await runScheduledAnalyses();
      this.stats.lastRunSummary = summary;
      this.stats.lastRunError = undefined;
      log.info(
        { ok: summary.ok, partial: summary.partial, failed: summary.failed },
        '主题综述周分析完成'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stats.lastRunError = message;
      log.error({ error: message }, '主题综述周分析失败');
    } finally {
      this.isExecuting = false;
    }
  }

  protected async waitForCompletion(): Promise<void> {
    if (!(await this.pollWhile(() => this.isExecuting, 300000))) {
      log.warn('关闭时主题综述仍在执行，已强制退出');
    }
  }

  static getInstance(): TopicAnalysisScheduler {
    if (!TopicAnalysisScheduler.instance) {
      TopicAnalysisScheduler.instance = new TopicAnalysisScheduler();
    }
    return TopicAnalysisScheduler.instance;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      enabled: this.isEnabled,
      schedule: this.cronSchedule,
      ...this.stats,
    };
  }
}

export function initTopicAnalysisScheduler(): TopicAnalysisScheduler {
  return TopicAnalysisScheduler.getInstance();
}
