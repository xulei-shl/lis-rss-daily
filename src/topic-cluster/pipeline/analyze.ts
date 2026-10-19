/**
 * 步骤 6：为脏主题重算多维分析（本模块唯一的批量 LLM 环节之一）。
 *
 * 幂等与重试纪律：
 *   - `status='ok'` / `'insufficient_data'` → 清除脏标记，本轮结束；
 *   - `status='failed'` → **保留脏标记**，下一轮自动重试。
 *     这样既不会因一次 LLM 抖动丢数据，也不会把失败静默当成完成。
 *
 * 调用量：等于本轮变脏的主题数（实测 0~3 个/天），与页面访问无关。
 */

import { logger } from '../../logger.js';
import { runTopicAnalysis } from '../service/analysis-runner.js';
import { clearTopicDirty, listDirtyTopics } from '../repo/topics.js';

const log = logger.child({ module: 'topic-cluster/analyze' });

export interface AnalysisStepResult {
  attempted: number;
  ok: number;
  insufficient: number;
  failed: number;
  failures: Array<{ topicId: number; error: string }>;
}

export interface RunAnalysesOptions {
  /** 单轮最多分析的主题数（控制 LLM 成本与任务时长） */
  limit?: number;
  /** 忽略 inputHash 强制重算 */
  force?: boolean;
}

export async function runPendingAnalyses(
  setVersion: number,
  options: RunAnalysesOptions = {}
): Promise<AnalysisStepResult> {
  const limit = options.limit ?? 20;
  const topics = (await listDirtyTopics(setVersion)).slice(0, limit);

  const result: AnalysisStepResult = {
    attempted: topics.length,
    ok: 0,
    insufficient: 0,
    failed: 0,
    failures: [],
  };
  if (topics.length === 0) return result;

  for (const topic of topics) {
    const outcome = await runTopicAnalysis(topic.id, { force: options.force });

    if (outcome.status === 'ok') {
      result.ok += 1;
      await clearTopicDirty(topic.id, new Date().toISOString());
    } else if (outcome.status === 'insufficient_data') {
      result.insufficient += 1;
      // 样本不足不是错误：已写入规则聚合结果，清除脏标记避免每轮重复计算
      await clearTopicDirty(topic.id, new Date().toISOString());
    } else {
      result.failed += 1;
      result.failures.push({ topicId: topic.id, error: outcome.error ?? '未知错误' });
      // 保留 is_dirty=1，下一轮重试
    }
  }

  log.info(
    { attempted: result.attempted, ok: result.ok, insufficient: result.insufficient, failed: result.failed },
    '多维分析完成'
  );

  return result;
}
