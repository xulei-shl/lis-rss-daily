/**
 * 主题质心加载（路由与回捞共用）。
 *
 * 只加载 NEW/ACTIVE 状态的主题——ARCHIVED 主题不再接受新文章，
 * 否则话题退潮后仍会持续吸收新文，导致归档失效。
 */

import { blobToVector } from '../domain/vector.js';
import { listRoutableTopics } from '../repo/topics.js';

export interface TopicCentroid {
  topicId: number;
  /** 已归一化 */
  centroid: Float32Array;
}

export interface LoadCentroidsResult {
  centroids: TopicCentroid[];
  /** 无质心（异常数据）而被跳过的主题 id */
  skippedTopicIds: number[];
}

export async function loadRoutableCentroids(setVersion: number): Promise<LoadCentroidsResult> {
  const topics = await listRoutableTopics(setVersion);
  const centroids: TopicCentroid[] = [];
  const skippedTopicIds: number[] = [];

  for (const topic of topics) {
    if (!topic.centroid) {
      skippedTopicIds.push(topic.id);
      continue;
    }
    centroids.push({ topicId: topic.id, centroid: blobToVector(topic.centroid) });
  }

  return { centroids, skippedTopicIds };
}
