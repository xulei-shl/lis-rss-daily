/**
 * 多归属路由决策（纯函数，无 IO）。
 *
 * 设计文档 §7.3：一篇文章可归属多个主题，但有上限；相似度最高者为「主归属」。
 * 本文件只做决策，不碰数据库——便于单测「超限替换」「相似度并列」等边界场景。
 */

import { cosine } from './vector.js';

/** 主题质心引用 */
export interface CentroidRef {
  topicId: number;
  /** 需已归一化 */
  centroid: Float32Array;
}

/** 打分结果 */
export interface ScoredTopic {
  topicId: number;
  similarity: number;
}

/** 该文章已有的链接 */
export interface ExistingLink {
  topicId: number;
  similarity: number;
}

export interface PlannedLink {
  topicId: number;
  similarity: number;
  /** 1 = 相似度最高 */
  rank: number;
  /** true 表示新增，false 表示仅更新 rank/主归属 */
  isNew: boolean;
}

export interface LinkPlan {
  /** 应当存在的链接（已按相似度降序、rank 已排好） */
  links: PlannedLink[];
  /** 需要删除的链接 topicId（超出上限被淘汰，或相似度被替换） */
  removals: number[];
  /** 主归属 topicId；无链接时为 null */
  primaryTopicId: number | null;
}

/**
 * 计算文章与全部主题的相似度，并筛出达标候选。
 *
 * @param vector 文章切面向量（需已归一化）
 * @param topics 主题质心列表
 * @param threshold 归入阈值
 * @param maxTopics 最多返回的候选数
 */
export function scoreTopics(
  vector: Float32Array,
  topics: CentroidRef[],
  threshold: number,
  maxTopics: number
): ScoredTopic[] {
  const hits: ScoredTopic[] = [];
  for (const topic of topics) {
    const similarity = cosine(vector, topic.centroid);
    if (similarity >= threshold) {
      hits.push({ topicId: topic.topicId, similarity });
    }
  }
  // 相似度降序；并列时按 topicId 升序，保证结果确定
  hits.sort((a, b) => b.similarity - a.similarity || a.topicId - b.topicId);
  return hits.slice(0, maxTopics);
}

/**
 * 合并「已有链接」与「本次候选」，产出最终链接计划。
 *
 * 规则：
 *   1. 候选相似度覆盖同 topicId 的已有链接（因为质心已变化，需重算）；
 *   2. 按相似度降序取前 maxTopics 条；
 *   3. 超限时，低相似度的已有链接被淘汰（removals）；
 *   4. 相似度最高者为唯一主归属。
 *
 * 该函数天然幂等：同一输入多次调用得到同一输出。
 */
export function planLinks(
  existing: ExistingLink[],
  candidates: ScoredTopic[],
  maxTopics: number
): LinkPlan {
  const merged = new Map<number, number>();
  for (const link of existing) merged.set(link.topicId, link.similarity);
  for (const hit of candidates) merged.set(hit.topicId, hit.similarity);

  const existingIds = new Set(existing.map((link) => link.topicId));

  const ordered = [...merged.entries()]
    .map(([topicId, similarity]) => ({ topicId, similarity }))
    .sort((a, b) => b.similarity - a.similarity || a.topicId - b.topicId)
    .slice(0, maxTopics);

  const keptIds = new Set(ordered.map((item) => item.topicId));

  const links: PlannedLink[] = ordered.map((item, index) => ({
    topicId: item.topicId,
    similarity: item.similarity,
    rank: index + 1,
    isNew: !existingIds.has(item.topicId),
  }));

  const removals = existing
    .map((link) => link.topicId)
    .filter((topicId) => !keptIds.has(topicId));

  return {
    links,
    removals,
    primaryTopicId: links.length > 0 ? links[0].topicId : null,
  };
}

/** 回捞打分结果（命中主题的文章） */
export interface ReclaimHit {
  articleId: number;
  similarity: number;
}

/**
 * 定向回捞候选筛选（设计文档 §7.4.1）。
 *
 * 新主题孵化后扫描全部已有切面的文章，把相似度达标的追加进去，
 * 以修补「新主题只从游离池取文章 → 先天不全」的问题。
 *
 * 注意：多归属模型下这是**纯追加**——不移动老主题的既有链接，
 * 因此老主题质心与既有分析不会被连带扰动。
 */
export function selectReclaimCandidates(
  articles: Array<{ articleId: number; vector: Float32Array }>,
  centroid: Float32Array,
  threshold: number
): ReclaimHit[] {
  const hits: ReclaimHit[] = [];
  for (const article of articles) {
    const similarity = cosine(article.vector, centroid);
    if (similarity >= threshold) {
      hits.push({ articleId: article.articleId, similarity });
    }
  }
  hits.sort((a, b) => b.similarity - a.similarity || a.articleId - b.articleId);
  return hits;
}
