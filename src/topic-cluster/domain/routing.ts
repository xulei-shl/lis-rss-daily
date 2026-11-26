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
  maxTopics: number,
  preferredPrimary?: { topicId: number; margin: number }
): LinkPlan {
  const merged = new Map<number, number>();
  for (const link of existing) merged.set(link.topicId, link.similarity);
  for (const hit of candidates) merged.set(hit.topicId, hit.similarity);

  const existingIds = new Set(existing.map((link) => link.topicId));

  const ordered = [...merged.entries()]
    .map(([topicId, similarity]) => ({ topicId, similarity }))
    .sort((a, b) => b.similarity - a.similarity || a.topicId - b.topicId)
    .slice(0, maxTopics);

  // 主归属迟滞：领先幅度不足 margin 时不翻转，避免周与周之间来回抖动。
  if (preferredPrimary) {
    const index = ordered.findIndex((item) => item.topicId === preferredPrimary.topicId);
    if (index > 0 && ordered[0].similarity < ordered[index].similarity + preferredPrimary.margin) {
      const [preferred] = ordered.splice(index, 1);
      ordered.unshift(preferred);
    }
  }

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

export interface RebalanceExistingLink extends ExistingLink {
  /** 是否为当前主归属 */
  isPrimary: boolean;
}

export interface RebalanceOptions {
  maxTopics: number;
  /** 归入阈值：新主题必须达到才会被追加 */
  simThreshold: number;
  /** 迟滞带：既有链接在 `simThreshold - margin` 以上就保留；主归属迁移需领先 margin */
  margin: number;
  /** 只允许这些主题接受新归属（未提供的主题仅参与保留判断） */
  newLinkTopicIds?: ReadonlySet<number>;
}

export interface RebalanceDecisions {
  /** 最终应存在的链接（相似度为本次重算值） */
  links: ScoredTopic[];
  added: number;
  removed: number;
  movedPrimary: boolean;
  /** 更强的挑战者被迟滞带抑制（下轮再评估） */
  deferred: boolean;
}

/**
 * 已归属文章的周期再平衡决策（纯函数，无 IO，迟滞微调）。
 *
 * 与 `planLinks` 的区别：这里从**全量相似度**出发重新判断归属，而不是只看游离池。
 * 规则：
 *   1. 既有链接在 `simThreshold - margin` 之上就保留（迟滞带，避免阈值附近抖动）；
 *   2. 低于保留线的既有链接被淘汰（文章回到游离池，等待重新孵化/归队）；
 *   3. 新增归属必须达到 `simThreshold`；
 *   4. 主归属迁移必须领先既有主归属 `margin`；未达标时暂缓（deferred），本轮不新增该挑战者。
 */
export function planRebalance(
  existing: RebalanceExistingLink[],
  scores: ScoredTopic[],
  options: RebalanceOptions
): RebalanceDecisions {
  const keepFloor = options.simThreshold - options.margin;
  const scoreByTopic = new Map(scores.map((item) => [item.topicId, item.similarity]));

  const currentPrimary =
    existing.find((link) => link.isPrimary) ??
    [...existing].sort((a, b) => b.similarity - a.similarity || a.topicId - b.topicId)[0];
  const currentPrimaryScore = currentPrimary
    ? scoreByTopic.get(currentPrimary.topicId)
    : undefined;
  const currentPrimaryKept =
    currentPrimary !== undefined &&
    currentPrimaryScore !== undefined &&
    currentPrimaryScore >= keepFloor;

  // 达标候选（新归属的唯一来源）
  const passing = scores
    .filter((item) => item.similarity >= options.simThreshold)
    .filter(
      (item) =>
        options.newLinkTopicIds === undefined || options.newLinkTopicIds.has(item.topicId)
    )
    .sort((a, b) => b.similarity - a.similarity || a.topicId - b.topicId);

  const existingIds = new Set(existing.map((link) => link.topicId));
  let deferred = false;
  const admitted: ScoredTopic[] = [];
  for (const candidate of passing) {
    const wouldTakeOverPrimary =
      currentPrimaryKept &&
      currentPrimary !== undefined &&
      candidate.topicId !== currentPrimary.topicId &&
      currentPrimaryScore !== undefined &&
      candidate.similarity > currentPrimaryScore;
    if (
      wouldTakeOverPrimary &&
      candidate.similarity < (currentPrimaryScore as number) + options.margin
    ) {
      // 迟滞只拦“勉强超过当前主归属”的挑战者；落后于主归属的正常次归属照常加入。
      deferred = true;
      continue;
    }
    admitted.push(candidate);
  }

  // 保留线以上的既有链接即使已不达归入阈值，也先留在候选池里（迟滞带）
  const pool = new Map<number, number>(admitted.map((item) => [item.topicId, item.similarity]));
  for (const link of existing) {
    const score = scoreByTopic.get(link.topicId);
    if (score !== undefined && score >= keepFloor) {
      const previous = pool.get(link.topicId);
      if (previous === undefined || score > previous) pool.set(link.topicId, score);
    }
  }

  const maxTopics = Math.max(1, options.maxTopics);
  const links = [...pool.entries()]
    .map(([topicId, similarity]) => ({ topicId, similarity }))
    .sort((a, b) => b.similarity - a.similarity || a.topicId - b.topicId)
    .slice(0, maxTopics);

  // 次归属同样适用迟滞：名额被新主题挤占时，如果新主题领先不足 margin，
  // 优先保留既有次归属（避免 0.71 / 0.72 两篇争夺同一个名额而周周互换）。
  for (const link of existing) {
    if (links.some((item) => item.topicId === link.topicId)) continue;
    const score = scoreByTopic.get(link.topicId);
    if (score === undefined || score < keepFloor) continue;
    const challengerIndex = links.findIndex(
      (item) =>
        !existingIds.has(item.topicId) && item.similarity < score + options.margin
    );
    if (challengerIndex >= 0) {
      links[challengerIndex] = { topicId: link.topicId, similarity: score };
      deferred = true;
    }
  }
  links.sort((a, b) => b.similarity - a.similarity || a.topicId - b.topicId);

  const keptIds = new Set(links.map((link) => link.topicId));
  const added = links.filter((link) => !existingIds.has(link.topicId)).length;
  const removed = existing.filter((link) => !keptIds.has(link.topicId)).length;
  // 主归属迁移同样需要迟滞：只有新首选领先既有主归属 margin 才算真正迁移。
  const movedPrimary =
    currentPrimaryKept &&
    currentPrimary !== undefined &&
    currentPrimaryScore !== undefined &&
    links.length > 0 &&
    links[0].topicId !== currentPrimary.topicId &&
    links[0].similarity >= currentPrimaryScore + options.margin;

  return { links, added, removed, movedPrimary, deferred };
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
