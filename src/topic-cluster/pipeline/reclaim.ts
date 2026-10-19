/**
 * 步骤 3.5：定向回捞（设计文档 §7.4.1）。
 *
 * 解决的问题：新主题只能从**游离池**取文章，而游离池只含「从未命中任何主题」的文章。
 * 那些**已被错分到老主题**的文章，没有任何机会被重新考虑 → 新主题先天不全。
 * θ_route 越松，游离池越空，新主题就越难孵出、孵出来也越不完整。
 *
 * 解法：用新主题质心扫描全部已归属文章，相似度达标的**追加**归属。
 *   - 复杂度 O(全库篇数 × 新主题数)，秒级以内；**零 LLM 调用**；
 *   - 多归属模型下这是**纯追加**，老主题质心与既有链接不受影响；
 *   - 刻意不做全量重聚类——那会导致主题漂移与成本爆炸（需求文档两条雷区）。
 */

import { logger } from '../../logger.js';
import { CLUSTER_CONFIG } from '../config.js';
import { selectReclaimCandidates } from '../domain/routing.js';
import { blobToVector } from '../domain/vector.js';
import { listFacets } from '../repo/facets.js';
import { addPeriodAdded, assignArticleToTopic, refreshTopicCounts } from '../repo/links.js';
import { getTopicById, markTopicDirty, updateTopicDates } from '../repo/topics.js';
import { resolveTopicDateRange } from '../service/centroid.js';

const log = logger.child({ module: 'topic-cluster/reclaim' });

export interface ReclaimResult {
  /** 被扫描的已归属文章数（= 全库切面数） */
  scannedArticles: number;
  /** 追加的链接数 */
  reclaimedLinks: number;
  /** 获得回捞链接的文章数 */
  reclaimedArticles: number;
  /** 因回捞而需要重算的主题（含被淘汰链接的老主题） */
  dirtyTopicIds: number[];
}

export async function runReclaim(input: {
  userId: number;
  setVersion: number;
  newTopicIds: number[];
}): Promise<ReclaimResult> {
  const result: ReclaimResult = {
    scannedArticles: 0,
    reclaimedLinks: 0,
    reclaimedArticles: 0,
    dirtyTopicIds: [],
  };
  if (input.newTopicIds.length === 0) return result;

  // 只加载新主题质心
  const newCentroids: Array<{ topicId: number; centroid: Float32Array }> = [];
  for (const topicId of input.newTopicIds) {
    const topic = await getTopicById(topicId);
    if (topic?.centroid) {
      newCentroids.push({ topicId, centroid: blobToVector(topic.centroid) });
    }
  }
  if (newCentroids.length === 0) return result;

  const facets = await listFacets(input.userId);
  result.scannedArticles = facets.length;
  if (facets.length === 0) return result;

  const articles = facets.map((facet) => ({
    articleId: facet.article_id,
    vector: blobToVector(facet.embedding),
  }));

  // 文章 → 命中候选（跨多个新主题合并，保证每篇文章只写一次事务）
  const candidatesByArticle = new Map<number, Array<{ topicId: number; similarity: number }>>();
  for (const { topicId, centroid } of newCentroids) {
    const hits = selectReclaimCandidates(articles, centroid, CLUSTER_CONFIG.reclaimThreshold);
    for (const hit of hits) {
      const list = candidatesByArticle.get(hit.articleId);
      const entry = { topicId, similarity: hit.similarity };
      if (list) list.push(entry);
      else candidatesByArticle.set(hit.articleId, [entry]);
    }
  }

  const gainedPerTopic = new Map<number, number>();

  for (const [articleId, candidates] of candidatesByArticle) {
    const assigned = await assignArticleToTopic({
      articleId,
      setVersion: input.setVersion,
      candidates,
      assignMethod: 'reclaim',
      maxTopics: CLUSTER_CONFIG.maxTopicsPerArticle,
    });

    const added = assigned.plan.links.filter((link) => link.isNew);
    if (added.length > 0) {
      result.reclaimedArticles += 1;
      result.reclaimedLinks += added.length;
      for (const link of added) {
        gainedPerTopic.set(link.topicId, (gainedPerTopic.get(link.topicId) ?? 0) + 1);
      }
    }

    // 被淘汰链接的老主题也要重算（多归属上限替换时会发生）
    for (const topicId of assigned.plan.removals) {
      gainedPerTopic.set(topicId, gainedPerTopic.get(topicId) ?? 0);
    }
  }

  result.dirtyTopicIds = [...gainedPerTopic.keys()].sort((a, b) => a - b);

  for (const topicId of result.dirtyTopicIds) {
    await refreshTopicCounts(topicId);
    await addPeriodAdded(topicId, gainedPerTopic.get(topicId) ?? 0);
    await markTopicDirty(topicId);
    const range = await resolveTopicDateRange(topicId);
    await updateTopicDates(topicId, range.first, range.last);
  }

  log.info(
    {
      newTopics: input.newTopicIds.length,
      scanned: result.scannedArticles,
      reclaimedLinks: result.reclaimedLinks,
      reclaimedArticles: result.reclaimedArticles,
    },
    '定向回捞完成'
  );

  return result;
}
