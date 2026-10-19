/**
 * 步骤 4 / 5：为本轮变脏的主题重算派生数据（簇内脉络 + 周期指标）。
 *
 * 两步放在一起的理由：它们消费同一份成员视图、同样的输入指纹，
 * 且都由 is_dirty 驱动，拆开只会重复加载一遍成员数据。
 * 二者都**零 token**——真正的 LLM 调用在下一步 analyze.ts。
 */

import { logger } from '../../logger.js';
import { listDirtyTopics } from '../repo/topics.js';
import { rebuildTopicMetrics } from '../service/metrics-builder.js';
import { rebuildTopicThreads } from '../service/thread-builder.js';

const log = logger.child({ module: 'topic-cluster/derive' });

export interface DeriveResult {
  dirtyTopics: number;
  threadsRebuilt: number;
  metricsRebuilt: number;
  threadsTotal: number;
  /** 切面缺失的成员（数据完整性信号，正常应为空） */
  missingFacetArticleIds: number[];
}

export async function runDeriveForDirtyTopics(setVersion: number): Promise<DeriveResult> {
  const topics = await listDirtyTopics(setVersion);

  const result: DeriveResult = {
    dirtyTopics: topics.length,
    threadsRebuilt: 0,
    metricsRebuilt: 0,
    threadsTotal: 0,
    missingFacetArticleIds: [],
  };
  if (topics.length === 0) return result;

  for (const topic of topics) {
    const threads = await rebuildTopicThreads(topic.id);
    result.threadsRebuilt += 1;
    result.threadsTotal += threads.threadCount;
    result.missingFacetArticleIds.push(...threads.missingFacetArticleIds);

    await rebuildTopicMetrics(topic.id);
    result.metricsRebuilt += 1;
  }

  if (result.missingFacetArticleIds.length > 0) {
    // 有链接但无切面 = 数据损坏或切面被删；不静默吞掉
    log.warn(
      { count: result.missingFacetArticleIds.length, sample: result.missingFacetArticleIds.slice(0, 10) },
      '存在无切面的归属链接，无法参与脉络计算'
    );
  }

  log.info(
    { topics: topics.length, threads: result.threadsTotal },
    '派生数据重算完成'
  );

  return result;
}
