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
import { updateTopicCentroid } from '../repo/topics.js';
import { loadTopicMembers } from './member-view.js';

export interface CentroidRefreshResult {
  articleCount: number;
  missingFacetArticleIds: number[];
  updated: boolean;
}

/** 由主题现有成员重算质心并落库；成员为空时保留原质心（避免抹掉主题语义中心） */
export async function refreshTopicCentroid(topicId: number): Promise<CentroidRefreshResult> {
  const { members, missingFacetArticleIds } = await loadTopicMembers(topicId);

  if (members.length === 0) {
    return { articleCount: 0, missingFacetArticleIds, updated: false };
  }

  const centroid = centroidOf(members.map((member) => member.vector));
  await updateTopicCentroid(topicId, vectorToBlob(centroid), centroid.length);

  return { articleCount: members.length, missingFacetArticleIds, updated: true };
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
