/**
 * 主题内洞察的规则层（零 token）：先对综述子簇聚出元簇，再按归属挂载研究空白。
 *
 * 设计要点（v3.1）：
 *   - 只用 `cluster_topic_reviews` 参与二次聚类，避免大量分面空白节点把综述元簇拆散；
 *   - 综述元簇确定后，`scope = 'subtopic'` 空白按 `subtopic_key` 精确挂载，
 *     `scope = 'topic'` 宏观空白按质心相似度挂载；
 *   - 节点向量全部复用已有产物，不产生任何 embedding 调用。
 */

import type {
  ClusterTopicGapsSelection,
  ClusterTopicReviewsSelection,
  ClusterTopicsSelection,
} from '../../db.js';
import { CLUSTER_LIMITS } from '../config.js';
import { cohesionClusters } from '../domain/clustering.js';
import { shortHash } from '../domain/hash.js';
import { blobToVector, dotNormalized } from '../domain/vector.js';
import type { DeepReview } from '../llm/review.js';
import type {
  InsightGapInput,
  InsightReviewInput,
} from '../llm/insight.js';
import type { InsightMemberRef } from '../repo/insights.js';
import { refKey } from '../repo/insights.js';

export interface InsightCluster {
  key: string;
  topicId: number;
  refs: InsightMemberRef[];
  topicIds: number[];
  centroid: Float32Array;
  scope: string;
  reviews: InsightReviewInput[];
  gaps: InsightGapInput[];
}

interface ReviewNode {
  ref: InsightMemberRef;
  review: ClusterTopicReviewsSelection;
  normKey: string;
  vector: Float32Array;
}

export interface BuildTopicInsightClustersInput {
  topic: ClusterTopicsSelection;
  /** 该主题的 active 综述；函数内部按 topic_id 再过滤一次，调用方传全量也可 */
  reviews: ClusterTopicReviewsSelection[];
  /** 该主题的 active 空白 */
  gaps: ClusterTopicGapsSelection[];
}

export function buildTopicInsightClusters(
  input: BuildTopicInsightClustersInput
): InsightCluster[] {
  const topic = input.topic;
  const topicName = topic.name;

  const topicReviews = input.reviews.filter((review) => review.topic_id === topic.id);
  // 只有一个子簇时没有「子簇之间」的洞察，直接跳过。
  if (topicReviews.length < CLUSTER_LIMITS.insightMinReviews) return [];

  const reviewNodes: ReviewNode[] = [];
  for (const review of topicReviews) {
    if (!review.centroid) continue;
    reviewNodes.push({
      ref: { kind: 'review', id: review.id, topicId: topic.id },
      review,
      normKey: review.review_key.replace(/^rv-/, ''),
      vector: blobToVector(review.centroid),
    });
  }

  if (reviewNodes.length < CLUSTER_LIMITS.insightMinReviews) return [];

  const targetCount = clamp(
    Math.ceil(reviewNodes.length / 4),
    1,
    CLUSTER_LIMITS.insightMaxReports
  );
  const { components } = cohesionClusters(
    reviewNodes.map((node, index) => ({ id: index, vector: node.vector })),
    CLUSTER_LIMITS.insightClusterThreshold,
    { minSize: CLUSTER_LIMITS.insightMinReviews, linkage: 'average', targetCount }
  );

  if (components.length === 0) return [];

  const topicGaps = input.gaps.filter((gap) => gap.topic_id === topic.id);
  const hasSubtopicScope = topicGaps.some((gap) => gap.scope === 'subtopic');

  const baseClusters = components
    .map((component) => {
      const members = component.ids
        .map((index) => reviewNodes[index])
        .filter((node): node is ReviewNode => Boolean(node))
        .sort(
          (a, b) =>
            dotNormalized(b.vector, component.centroid) - dotNormalized(a.vector, component.centroid) ||
            a.review.id - b.review.id
        )
        .slice(0, CLUSTER_LIMITS.insightEvidenceCap);

      return {
        centroid: component.centroid,
        members,
        byNormKey: new Map(members.map((node) => [node.normKey, node.review])),
        subtopicGaps: [] as Array<{ gap: ClusterTopicGapsSelection; sourceReview: ClusterTopicReviewsSelection; score: number }>,
        macroGaps: [] as Array<{ gap: ClusterTopicGapsSelection; sourceReview: ClusterTopicReviewsSelection | null; score: number }>,
      };
    })
    .filter((cluster) => cluster.members.length >= CLUSTER_LIMITS.insightMinReviews);

  if (baseClusters.length === 0) return [];

  // 挂载空白：分面空白按 subtopic_key 精确入簇；宏观空白优先按 subtopic_key，其次按质心相似度入最相近元簇
  for (const gap of topicGaps) {
    const gapScope = gap.scope === 'subtopic' ? 'subtopic' : 'topic';
    // 已有子主题独立 LLM 空白时，忽略宏观阶段 B 的旧 limitation 空白以减少重复与噪音
    if (hasSubtopicScope && gapScope === 'topic' && gap.basis === 'limitation') {
      continue;
    }

    const gapNormKey = gap.subtopic_key ? gap.subtopic_key.replace(/^rv-/, '') : null;
    const gapVector = gap.embedding ? blobToVector(gap.embedding) : null;

    if (gapScope === 'subtopic') {
      if (!gapNormKey) continue;
      for (const cluster of baseClusters) {
        const sourceReview = cluster.byNormKey.get(gapNormKey);
        if (!sourceReview) continue;
        const score = gapVector ? dotNormalized(gapVector, cluster.centroid) : 1;
        cluster.subtopicGaps.push({ gap, sourceReview, score });
      }
      continue;
    }

    let matchedCluster: (typeof baseClusters)[number] | null = null;
    let matchedReview: ClusterTopicReviewsSelection | null = null;
    let matchedScore = -Infinity;

    if (gapNormKey) {
      for (const cluster of baseClusters) {
        const review = cluster.byNormKey.get(gapNormKey);
        if (review) {
          matchedCluster = cluster;
          matchedReview = review;
          matchedScore = gapVector ? dotNormalized(gapVector, cluster.centroid) : 1;
          break;
        }
      }
    }

    if (!matchedCluster && gapVector) {
      for (const cluster of baseClusters) {
        const sim = dotNormalized(gapVector, cluster.centroid);
        if (sim >= CLUSTER_LIMITS.insightClusterThreshold && sim > matchedScore) {
          matchedScore = sim;
          matchedCluster = cluster;
        }
      }
    }

    if (matchedCluster) {
      matchedCluster.macroGaps.push({
        gap,
        sourceReview: matchedReview,
        score: matchedScore,
      });
    }
  }

  const clusters: InsightCluster[] = baseClusters.map((cluster) => {
    const subtopicSorted = [...cluster.subtopicGaps].sort(
      (a, b) => b.score - a.score || a.gap.id - b.gap.id
    );
    const macroSorted = [...cluster.macroGaps].sort(
      (a, b) => b.score - a.score || a.gap.id - b.gap.id
    );

    const selectedGapEntries = [...subtopicSorted, ...macroSorted].slice(
      0,
      CLUSTER_LIMITS.insightGapCap
    );

    const refs: InsightMemberRef[] = [
      ...cluster.members.map((node) => node.ref),
      ...selectedGapEntries.map((entry) => ({
        kind: 'gap' as const,
        id: entry.gap.id,
        topicId: topic.id,
      })),
    ];

    // 报告身份锚点只取核心综述节点，避免空白更新导致 report_key 漂移
    const anchor = cluster.members
      .slice(0, 3)
      .map((node) => refKey(node.ref))
      .sort();

    const includeLimitations = !hasSubtopicScope;
    const reviews = cluster.members.map((node) =>
      toReviewInput(node.review, topicName, includeLimitations)
    );

    const gaps: InsightGapInput[] = selectedGapEntries.map(({ gap, sourceReview }) => ({
      id: gap.id,
      gap: gap.gap,
      basis: gap.basis,
      scope: gap.scope === 'subtopic' ? 'subtopic' : 'topic',
      sourceReviewId: sourceReview?.id ?? null,
      subtopicTitle: sourceReview?.title ?? null,
      topicName,
      method: gap.method,
      object: gap.object,
    }));

    return {
      key: `ins-${shortHash(`topic:${topic.id}|${anchor.join('|')}`, 10)}`,
      topicId: topic.id,
      refs,
      topicIds: [topic.id],
      centroid: cluster.centroid,
      scope: `${topicName}（主题内 ${cluster.members.length} 个综述子簇）`,
      reviews,
      gaps,
    };
  });

  return clusters
    .sort((a, b) => b.refs.length - a.refs.length || a.key.localeCompare(b.key))
    .slice(0, CLUSTER_LIMITS.insightMaxReports);
}

function toReviewInput(
  review: ClusterTopicReviewsSelection,
  topicName: string,
  includeLimitations: boolean
): InsightReviewInput {
  const parsed = parseReview(review.review_json);
  const sections: Record<string, string> = {};
  if (parsed) {
    for (const [key, value] of Object.entries(parsed.sections)) {
      if (!includeLimitations && key === 'limitations') continue;
      if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string') {
        sections[key] = value.text;
      }
    }
  }
  return {
    id: review.id,
    title: review.title,
    abstract: review.abstract,
    topicName,
    sections,
  };
}

function parseReview(raw: string): DeepReview | null {
  try {
    const parsed = JSON.parse(raw) as DeepReview;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export { refKey };

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
