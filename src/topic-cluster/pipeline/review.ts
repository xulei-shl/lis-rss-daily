/**
 * 步骤 7：为脏主题重算深度综述（主题内语义子簇）。
 *
 * 与步骤 6 的纪律一致：
 *   - 全部子簇成功才清除 review_dirty；
 *   - 部分失败保留脏标记，下一轮只重试未成功的子簇（已成功的 hash 命中会跳过）；
 *   - 失败不改写旧综述。
 */

import { logger } from '../../logger.js';
import { listReviewDirtyTopics } from '../repo/topics.js';
import { runTopicReviews } from '../service/review-runner.js';

const log = logger.child({ module: 'topic-cluster/review' });

export interface ReviewStepResult {
  attempted: number;
  ok: number;
  partial: number;
  skipped: number;
  failed: number;
  created: number;
  updated: number;
  /** 因单轮上限未处理、留到下一轮的主题数 */
  backlog: number;
  failures: Array<{ topicId: number; error: string }>;
}

export interface RunReviewsOptions {
  limit?: number;
  force?: boolean;
}

export async function runPendingReviews(
  setVersion: number,
  options: RunReviewsOptions = {}
): Promise<ReviewStepResult> {
  const limit = Math.max(options.limit ?? 10, 1);
  const dirtyTopics = await listReviewDirtyTopics(setVersion);
  const topics = dirtyTopics.slice(0, limit);

  const result: ReviewStepResult = {
    attempted: topics.length,
    ok: 0,
    partial: 0,
    skipped: 0,
    failed: 0,
    created: 0,
    updated: 0,
    backlog: Math.max(dirtyTopics.length - topics.length, 0),
    failures: [],
  };

  for (const topic of topics) {
    const outcome = await runTopicReviews(topic.id, { force: options.force });
    result.created += outcome.created;
    result.updated += outcome.updated;

    if (outcome.status === 'ok') result.ok += 1;
    else if (outcome.status === 'partial') result.partial += 1;
    else if (outcome.status === 'skipped') result.skipped += 1;
    else {
      result.failed += 1;
      result.failures.push({ topicId: topic.id, error: outcome.error ?? '未知错误' });
    }
  }

  log.info(
    {
      attempted: result.attempted,
      ok: result.ok,
      partial: result.partial,
      skipped: result.skipped,
      failed: result.failed,
      created: result.created,
      updated: result.updated,
    },
    '深度综述完成'
  );

  return result;
}
