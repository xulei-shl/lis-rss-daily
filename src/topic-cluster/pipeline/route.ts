/**
 * 步骤 2：增量路由。
 *
 * 语义：把「尚无任何归属」的文章按最高相似度归入既有主题（多归属，上限见配置）。
 * 已有归属的文章**不在本步骤处理**——它们只可能通过 §7.4.1 的定向回捞被追加，
 * 这是为了避免每天跑一次全量重聚类导致主题漂移与成本爆炸。
 *
 * 复杂度 O(游离池 × 主题数)，毫秒级、零 LLM 调用。
 */

import { logger } from '../../logger.js';
import { CLUSTER_CONFIG } from '../config.js';
import { blobToVector } from '../domain/vector.js';
import { scoreTopics } from '../domain/routing.js';
import { listUnroutedFacets } from '../repo/facets.js';
import { addPeriodAdded, assignArticleToTopic, refreshTopicCounts } from '../repo/links.js';
import { markTopicDirty, setTopicStatus, updateTopicDates } from '../repo/topics.js';
import { resolveTopicDateRange } from '../service/centroid.js';
import { loadRoutableCentroids } from './centroids.js';

const log = logger.child({ module: 'topic-cluster/route' });

export interface RouteResult {
  /** 参与路由的游离文章数 */
  poolSize: number;
  /** 本轮产生归属的文章数 */
  routedArticles: number;
  /** 新增的链接数（同一篇可能进入多个主题） */
  newLinks: number;
  /** 受影响的主题 id（需重算计数/脉络/分析） */
  affectedTopicIds: number[];
  routableTopicCount: number;
  skippedTopicIds: number[];
}

export async function runIncrementalRouting(input: {
  userId: number;
  setVersion: number;
}): Promise<RouteResult> {
  const { centroids, skippedTopicIds } = await loadRoutableCentroids(input.setVersion);
  const pool = await listUnroutedFacets(input.userId, input.setVersion);

  const result: RouteResult = {
    poolSize: pool.length,
    routedArticles: 0,
    newLinks: 0,
    affectedTopicIds: [],
    routableTopicCount: centroids.length,
    skippedTopicIds,
  };

  if (centroids.length === 0 || pool.length === 0) {
    log.info(
      { poolSize: pool.length, topics: centroids.length },
      '增量路由跳过（无主题或无游离文章）'
    );
    return result;
  }

  const gainedPerTopic = new Map<number, number>();

  for (const facet of pool) {
    const vector = blobToVector(facet.embedding);
    const candidates = scoreTopics(
      vector,
      centroids,
      CLUSTER_CONFIG.simThreshold,
      CLUSTER_CONFIG.maxTopicsPerArticle
    );
    if (candidates.length === 0) continue;

    const assigned = await assignArticleToTopic({
      articleId: facet.article_id,
      setVersion: input.setVersion,
      candidates,
      assignMethod: 'centroid',
      maxTopics: CLUSTER_CONFIG.maxTopicsPerArticle,
    });

    const added = assigned.plan.links.filter((link) => link.isNew).length;
    if (added > 0) {
      result.routedArticles += 1;
      result.newLinks += added;
      for (const link of assigned.plan.links) {
        if (link.isNew) {
          gainedPerTopic.set(link.topicId, (gainedPerTopic.get(link.topicId) ?? 0) + 1);
        }
      }
    }
  }

  result.affectedTopicIds = [...gainedPerTopic.keys()].sort((a, b) => a - b);

  for (const topicId of result.affectedTopicIds) {
    await refreshTopicCounts(topicId);
    await addPeriodAdded(topicId, gainedPerTopic.get(topicId) ?? 0);
    await setTopicStatus(topicId, 'ACTIVE');
    await markTopicDirty(topicId);
    const range = await resolveTopicDateRange(topicId);
    await updateTopicDates(topicId, range.first, range.last);
  }

  log.info(
    {
      poolSize: result.poolSize,
      routed: result.routedArticles,
      newLinks: result.newLinks,
      topicsTouched: result.affectedTopicIds.length,
    },
    '增量路由完成'
  );

  return result;
}
