/**
 * 周期归属再平衡（步骤 4.5）。
 *
 * 解决的问题：增量路由只处理「零归属」的文章，定向回捞只在新主题孵化时触发。
 * 一篇被误分或勉强寄养的文章，只要没有新主题诞生，就再也不会被重新评估——
 * 主题成员会随着时间越来越不贴合当前语义分布。
 *
 * 本步骤每周对所有已归属文章重算与各主题质心的相似度，按迟滞规则（见
 * `domain/routing.ts:planRebalance`）迁移主归属、追加次要归属、淘汰弱链接，
 * 让游离池与主题成员保持动态可纠正。纯向量计算，零 LLM 调用。
 *
 * 关键约束：
 *   - 只处理「有切面的已归属文章」；缺切面的文章直接跳过，绝不能因此删链接；
 *   - 质心在扫描前由 `refreshCentroidsForVersion()` 统一刷新，扫描期间保持快照，
 *     保证本轮决策可复现（不受遍历顺序影响）；
 *   - 成员变动后同步刷新计数、时间范围、质心，并标记脏主题，由周分析重算洞察。
 */

import { logger } from '../../logger.js';
import { CLUSTER_CONFIG } from '../config.js';
import { planRebalance, scoreTopics } from '../domain/routing.js';
import { blobToVector, centroidOf } from '../domain/vector.js';
import { listFacets } from '../repo/facets.js';
import {
  assignArticleToTopic,
  listAllLinksForVersion,
  refreshTopicCounts,
} from '../repo/links.js';
import type { TopicRebalanceDeltas } from '../repo/run-logs.js';
import {
  listTopicsByVersion,
  markTopicDirty,
  updateTopicDates,
} from '../repo/topics.js';
import { refreshTopicCentroid, resolveTopicDateRange } from '../service/centroid.js';
import { loadTopicMembers } from '../service/member-view.js';

const log = logger.child({ module: 'topic-cluster/rebalance' });

export interface RebalanceResult {
  /** 参与重算的已归属文章数（有切面且有链接） */
  scannedArticles: number;
  /** 归属链接集合或主归属发生变化的文章数 */
  changedArticles: number;
  addedLinks: number;
  removedLinks: number;
  primarySwitches: number;
  /** 因迟滞带被暂缓的挑战者次数（诊断抖动用） */
  deferredCandidates: number;
  /** 缺切面而跳过的文章数（不能删其链接） */
  skippedMissingFacet: number;
  /** 成员发生变化的主题（已刷新计数并标脏） */
  affectedTopicIds: number[];
  /** 按主题的再平衡增量（未改动的主题不出现） */
  topicDeltas: TopicRebalanceDeltas;
  skippedReason: string | null;
}

export async function runAssignmentRebalance(input: {
  userId: number;
  setVersion: number;
  /** 覆盖迟滞带宽度（命令行 --margin 用，不改配置） */
  margin?: number;
  /** 预检模式：只用内存质心估算，不写库 */
  dryRun?: boolean;
}): Promise<RebalanceResult> {
  const margin = input.margin ?? CLUSTER_CONFIG.rebalanceMargin;
  const result: RebalanceResult = {
    scannedArticles: 0,
    changedArticles: 0,
    addedLinks: 0,
    removedLinks: 0,
    primarySwitches: 0,
    deferredCandidates: 0,
    skippedMissingFacet: 0,
    affectedTopicIds: [],
    topicDeltas: {},
    skippedReason: null,
  };

  const facets = await listFacets(input.userId);
  const links = await listAllLinksForVersion(input.setVersion);
  if (facets.length === 0) {
    result.skippedReason = '无切面数据';
    return result;
  }
  if (links.length === 0) {
    result.skippedReason = '无已归属文章';
    return result;
  }

  const topics = await listTopicsByVersion(input.setVersion);
  // 预检不写库，因此用「主归属成员的实时均值」在内存里重建质心，
  // 保证 dry-run 的估算与正式执行尽量一致。
  const centroids = input.dryRun
    ? await buildCentroidsInMemory(topics)
    : topics
        .filter((topic) => topic.centroid)
        .map((topic) => ({ topicId: topic.id, centroid: blobToVector(topic.centroid!) }));
  if (centroids.length === 0) {
    result.skippedReason = '主题均无质心';
    return result;
  }

  // ARCHIVED / 异常状态的主题仍参与打分（用于保留判断），但不接受新归属。
  const routableTopicIds = new Set(
    topics.filter((topic) => topic.status === 'NEW' || topic.status === 'ACTIVE').map((topic) => topic.id)
  );

  const vectorByArticle = new Map(
    facets.map((facet) => [facet.article_id, blobToVector(facet.embedding)])
  );
  const linksByArticle = new Map<number, typeof links>();
  for (const link of links) {
    const list = linksByArticle.get(link.article_id);
    if (list) list.push(link);
    else linksByArticle.set(link.article_id, [link]);
  }

  const touchedTopicIds = new Set<number>();

  for (const [articleId, articleLinks] of linksByArticle) {
    const vector = vectorByArticle.get(articleId);
    if (!vector) {
      result.skippedMissingFacet += 1;
      continue;
    }

    result.scannedArticles += 1;
    const scores = scoreTopics(vector, centroids, 0, centroids.length);
    const existing = articleLinks.map((link) => ({
      topicId: link.topic_id,
      similarity: link.similarity,
      isPrimary: link.is_primary === 1,
    }));

    const decisions = planRebalance(existing, scores, {
      maxTopics: CLUSTER_CONFIG.maxTopicsPerArticle,
      simThreshold: CLUSTER_CONFIG.simThreshold,
      margin,
      newLinkTopicIds: routableTopicIds,
    });
    if (decisions.deferred) result.deferredCandidates += 1;

    if (decisions.added === 0 && decisions.removed === 0 && !decisions.movedPrimary) continue;

    const currentPrimary = existing.find((link) => link.isPrimary);
    const preferredPrimary =
      !decisions.movedPrimary &&
      currentPrimary &&
      decisions.links.some((link) => link.topicId === currentPrimary.topicId)
        ? { topicId: currentPrimary.topicId, margin }
        : undefined;

    if (!input.dryRun) {
      await assignArticleToTopic({
        articleId,
        setVersion: input.setVersion,
        candidates: decisions.links,
        assignMethod: 'centroid',
        maxTopics: CLUSTER_CONFIG.maxTopicsPerArticle,
        preferredPrimary,
      });
    }

    result.changedArticles += 1;
    result.addedLinks += decisions.added;
    result.removedLinks += decisions.removed;
    if (decisions.movedPrimary) result.primarySwitches += 1;

    const existingTopicIds = new Set(existing.map((link) => link.topicId));
    const keptTopicIds = new Set(decisions.links.map((link) => link.topicId));
    const bumpDelta = (topicId: number) => {
      const key = String(topicId);
      if (!result.topicDeltas[key]) {
        result.topicDeltas[key] = { added: 0, removed: 0, migratedIn: 0 };
      }
      return result.topicDeltas[key];
    };
    for (const link of decisions.links) {
      if (!existingTopicIds.has(link.topicId)) bumpDelta(link.topicId).added += 1;
    }
    for (const link of existing) {
      if (!keptTopicIds.has(link.topicId)) bumpDelta(link.topicId).removed += 1;
    }
    if (decisions.movedPrimary && decisions.links[0]) {
      bumpDelta(decisions.links[0].topicId).migratedIn += 1;
    }

    for (const link of articleLinks) touchedTopicIds.add(link.topic_id);
    for (const link of decisions.links) touchedTopicIds.add(link.topicId);
  }

  if (!input.dryRun) {
    for (const topicId of touchedTopicIds) {
      await refreshTopicCounts(topicId);
      const range = await resolveTopicDateRange(topicId);
      await updateTopicDates(topicId, range.first, range.last);
      await refreshTopicCentroid(topicId);
      await markTopicDirty(topicId);
    }
  }
  result.affectedTopicIds = [...touchedTopicIds].sort((a, b) => a - b);

  log.info(
    {
      dryRun: Boolean(input.dryRun),
      scanned: result.scannedArticles,
      changed: result.changedArticles,
      added: result.addedLinks,
      removed: result.removedLinks,
      primarySwitches: result.primarySwitches,
      deferred: result.deferredCandidates,
      topics: result.affectedTopicIds.length,
    },
    '归属再平衡完成'
  );

  return result;
}

/** dry-run 专用：按主归属成员在内存里重算质心（不落库） */
async function buildCentroidsInMemory(
  topics: Array<{ id: number; centroid: Buffer | null }>
): Promise<Array<{ topicId: number; centroid: Float32Array }>> {
  const result: Array<{ topicId: number; centroid: Float32Array }> = [];
  for (const topic of topics) {
    const { members } = await loadTopicMembers(topic.id, { primaryOnly: true });
    const vector =
      members.length > 0
        ? centroidOf(members.map((member) => member.vector))
        : topic.centroid
          ? blobToVector(topic.centroid)
          : null;
    if (vector) result.push({ topicId: topic.id, centroid: vector });
  }
  return result;
}
