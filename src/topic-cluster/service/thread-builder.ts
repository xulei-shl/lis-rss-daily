/**
 * 簇内脉络构建（规则先行，零 token）。
 *
 * 流程：成员视图 → 角度分群 → 角度内时间串链 → 落库。
 * LLM **不参与**这一步；它的角度名与叙述由 analysis-runner 事后按 angle_key 回填。
 *
 * 降级纪律：某角度的相邻承接率低于阈值，或篇数不足时，该角度不生成脉络，
 * 其成员归入「零散研究」平铺展示——宁可少给结论，也不编造研究演进（设计文档 §7.5）。
 */

import { CLUSTER_CONFIG, CLUSTER_LIMITS } from '../config.js';
import { buildThreads, groupAngles, type ChainItem } from '../domain/chaining.js';
import { splitByMedian, trendLabel } from '../domain/metrics.js';
import { replaceTopicThreads, type ThreadWriteRow } from '../repo/threads.js';
import { loadTopicMembers, type TopicMemberView } from './member-view.js';

export interface ThreadBuildResult {
  memberCount: number;
  threadCount: number;
  looseCount: number;
  angleKeys: string[];
  /** 切面缺失、无法参与分链的成员 */
  missingFacetArticleIds: number[];
}

/** 重建某主题的脉络（整体替换，天然幂等） */
export async function rebuildTopicThreads(topicId: number): Promise<ThreadBuildResult> {
  const { members, missingFacetArticleIds } = await loadTopicMembers(topicId);

  if (members.length === 0) {
    await replaceTopicThreads(topicId, []);
    return {
      memberCount: 0,
      threadCount: 0,
      looseCount: 0,
      angleKeys: [],
      missingFacetArticleIds,
    };
  }

  const items: ChainItem[] = members.map(toChainItem);

  const angles = groupAngles(items, CLUSTER_CONFIG.angleThreshold, {
    maxAngleCount: CLUSTER_LIMITS.maxAngleCount,
    minAngleSize: CLUSTER_LIMITS.minAngleSize,
  });

  const { threads, loose } = buildThreads(angles, {
    minThreadLength: CLUSTER_LIMITS.minThreadLength,
    strongThreshold: CLUSTER_CONFIG.strongThreshold,
    chainThreshold: CLUSTER_CONFIG.chainThreshold,
    minContinuityRatio: CLUSTER_LIMITS.minContinuityRatio,
  });

  const dateOf = new Map(members.map((member) => [member.articleId, member.eventDate]));

  const rows: ThreadWriteRow[] = threads.map((thread) => {
    const dates = thread.steps
      .map((step) => dateOf.get(step.articleId) ?? null)
      .filter((date): date is string => Boolean(date))
      .sort();

    return {
      angleKey: thread.angleKey,
      angleLabel: null,
      steps: thread.steps.map((step) => ({
        articleId: step.articleId,
        seq: step.seq,
        relation: step.relation,
        similarityToPrev: step.similarityToPrev,
        sharedMethod: step.sharedMethod,
        sharedObject: step.sharedObject,
      })),
      periodStart: dates.length > 0 ? dates[0] : null,
      periodEnd: dates.length > 0 ? dates[dates.length - 1] : null,
      trend: threadTrend(thread.steps.map((step) => step.articleId), dateOf),
      summary: null,
    };
  });

  await replaceTopicThreads(topicId, rows);

  return {
    memberCount: members.length,
    threadCount: rows.length,
    looseCount: loose.length,
    angleKeys: rows.map((row) => row.angleKey),
    missingFacetArticleIds,
  };
}

function toChainItem(member: TopicMemberView): ChainItem {
  return {
    articleId: member.articleId,
    vector: member.vector,
    eventDate: member.eventDate,
    precision: member.precision,
    methodKeys: member.methodKeys,
    objectKeys: member.objectKeys,
  };
}

/**
 * 线索趋势：按时间中位数切成前后两段比密度。
 * 样本不足时返回 null —— 前端据此显示「样本不足」，不画趋势箭头。
 */
function trendLabelForDates(dates: string[]): ReturnType<typeof trendLabel> {
  const { first, second } = splitByMedian(dates);
  return trendLabel(
    first.length,
    second.length,
    CLUSTER_CONFIG.minTrendSamples,
    CLUSTER_LIMITS.trendUpRatio,
    CLUSTER_LIMITS.trendDownRatio
  );
}

function threadTrend(
  articleIds: number[],
  dateOf: Map<number, string | null>
): ReturnType<typeof trendLabel> {
  const dates = articleIds
    .map((articleId) => dateOf.get(articleId) ?? null)
    .filter((date): date is string => Boolean(date))
    .sort();
  return trendLabelForDates(dates);
}
