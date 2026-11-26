/**
 * 质心维护。
 *
 * ⚠️ 关键取舍（设计文档 §7.3）：多归属模型下**禁止用滑动平均做增删**。
 * 滑动平均 `V' = (N·V + v) / (N+1)` 只能增量更新，一旦要"减掉"某篇向量
 * （回捞后被淘汰、未来人工排除等），反推会产生误差累积。
 *
 * 因此这里一律**从当前成员重新求均值再归一化**。成员规模在数十篇量级，
 * 全量重算是毫秒级，没有性能理由去做增量。
 */

import { centroidOf } from '../domain/vector.js';
import { vectorToBlob } from '../domain/vector.js';
import { listRoutableTopics, updateTopicCentroid } from '../repo/topics.js';
import { loadTopicMembers } from './member-view.js';

export interface CentroidRefreshResult {
  articleCount: number;
  missingFacetArticleIds: number[];
  updated: boolean;
}


/**
 * 由主题现有成员重算质心并落库；成员为空时保留原质心（避免抹掉主题语义中心）。
 *
 * 口径：只取**主归属**成员。多归属下的次要链接只表示“也相关”，若计入质心，
 * 每次追加/淘汰次归属都会拉动质心，再反作用于下一轮的归属判断，形成振荡。
 * 主归属才是主题的核心成员。
 */
export async function refreshTopicCentroid(topicId: number): Promise<CentroidRefreshResult> {
  const { members, missingFacetArticleIds } = await loadTopicMembers(topicId, {
    primaryOnly: true,
  });

  if (members.length === 0) {
    return { articleCount: 0, missingFacetArticleIds, updated: false };
  }

  const centroid = centroidOf(members.map((member) => member.vector));
  await updateTopicCentroid(topicId, vectorToBlob(centroid), centroid.length);

  return { articleCount: members.length, missingFacetArticleIds, updated: true };
}

/**
 * 按当前成员重算某版本全部可路由主题的质心。
 *
 * 路由/回捞都依赖质心打分；成员只增不减时质心也必须跟着走，
 * 否则新文献永远被“冷启动那天的语义中心”评判。
 */
export async function refreshCentroidsForVersion(
  setVersion: number
): Promise<{ refreshed: number; failedTopicIds: number[] }> {
  const topics = await listRoutableTopics(setVersion);
  const failedTopicIds: number[] = [];
  let refreshed = 0;

  for (const topic of topics) {
    try {
      const result = await refreshTopicCentroid(topic.id);
      if (result.updated) refreshed += 1;
    } catch {
      failedTopicIds.push(topic.id);
    }
  }

  return { refreshed, failedTopicIds };
}

/** 主题的期界时间（首篇 / 末篇事件时间），用于 DORMANT 判定与前端展示 */
export async function resolveTopicDateRange(
  topicId: number
): Promise<{ first: string | null; last: string | null }> {
  const { members } = await loadTopicMembers(topicId);
  const dates = members
    .map((member) => member.eventDate)
    .filter((date): date is string => typeof date === 'string' && date.length > 0)
    .sort();

  return {
    first: dates.length > 0 ? dates[0] : null,
    last: dates.length > 0 ? dates[dates.length - 1] : null,
  };
}
