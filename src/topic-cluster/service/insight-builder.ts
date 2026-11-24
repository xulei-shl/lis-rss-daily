/**
 * 主题内洞察的规则层（零 token）：对单个大主题的综述子簇 + 研究空白二次聚类。
 *
 * 节点向量全部复用已有产物：
 *   - 综述 → 子簇质心；
 *   - 空白 → 证据文献切面的质心。
 * 因此二次聚类不产生任何 embedding 调用。
 *
 * 每个元簇至少包含两个综述子簇，保证报告是在「子簇之间」做综合，
 * 而不是复述某一篇综述。
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

interface Node {
  ref: InsightMemberRef;
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
  const topicGaps = input.gaps.filter((gap) => gap.topic_id === topic.id);

  const nodes: Node[] = [];
  for (const review of topicReviews) {
    if (!review.centroid) continue;
    nodes.push({
      ref: { kind: 'review', id: review.id, topicId: topic.id },
      vector: blobToVector(review.centroid),
    });
  }
  for (const gap of topicGaps) {
    if (!gap.embedding) continue;
    nodes.push({
      ref: { kind: 'gap', id: gap.id, topicId: topic.id },
      vector: blobToVector(gap.embedding),
    });
  }

  if (nodes.length < CLUSTER_LIMITS.insightMinNodes) return [];

  const targetCount = clamp(
    Math.ceil(nodes.length / 6),
    1,
    CLUSTER_LIMITS.insightMaxReports
  );
  const { components } = cohesionClusters(
    nodes.map((node, index) => ({ id: index, vector: node.vector })),
    CLUSTER_LIMITS.insightClusterThreshold,
    { minSize: CLUSTER_LIMITS.insightMinNodes, linkage: 'average', targetCount }
  );

  const reviewById = new Map(topicReviews.map((review) => [review.id, review]));
  const gapById = new Map(topicGaps.map((gap) => [gap.id, gap]));
  const clusters: InsightCluster[] = [];

  for (const component of components) {
    const componentNodes = component.ids
      .map((index) => nodes[index])
      .filter((node): node is Node => Boolean(node));

    const reviewNodes = componentNodes.filter((node) => node.ref.kind === 'review');
    // 纯空白簇不算洞察；至少要跨两个综述子簇。
    if (reviewNodes.length < CLUSTER_LIMITS.insightMinReviews) continue;

    const selected = selectRepresentatives(componentNodes, component.centroid);
    const refs = selected.map((node) => node.ref);
    const anchor = [...selected]
      .sort((a, b) => dotNormalized(b.vector, component.centroid) - dotNormalized(a.vector, component.centroid))
      .slice(0, 3)
      .map((node) => refKey(node.ref))
      .sort();

    const reviews = selected
      .filter((node) => node.ref.kind === 'review')
      .map((node) => reviewById.get(node.ref.id))
      .filter((review): review is ClusterTopicReviewsSelection => Boolean(review))
      .map((review) => toReviewInput(review, topicName));

    const gaps = selected
      .filter((node) => node.ref.kind === 'gap')
      .map((node) => gapById.get(node.ref.id))
      .filter((gap): gap is ClusterTopicGapsSelection => Boolean(gap))
      .map((gap) => ({
        id: gap.id,
        gap: gap.gap,
        basis: gap.basis,
        topicName,
        method: gap.method,
        object: gap.object,
      }));

    clusters.push({
      key: `ins-${shortHash(`topic:${topic.id}|${anchor.join('|')}`, 10)}`,
      topicId: topic.id,
      refs,
      topicIds: [topic.id],
      centroid: component.centroid,
      scope: `${topicName}（主题内 ${reviewNodes.length} 个综述子簇）`,
      reviews,
      gaps,
    });
  }

  return clusters
    .sort((a, b) => b.refs.length - a.refs.length || a.key.localeCompare(b.key))
    .slice(0, CLUSTER_LIMITS.insightMaxReports);
}

/** 元簇内抽样：按到质心的相似度取代表，综述与空白各不超过 evidenceCap */
function selectRepresentatives(nodes: Node[], centroid: Float32Array): Node[] {
  const scored = [...nodes].sort(
    (a, b) =>
      dotNormalized(b.vector, centroid) - dotNormalized(a.vector, centroid) ||
      refKey(a.ref).localeCompare(refKey(b.ref))
  );
  const reviews = scored.filter((node) => node.ref.kind === 'review').slice(0, CLUSTER_LIMITS.insightEvidenceCap);
  const gaps = scored.filter((node) => node.ref.kind === 'gap').slice(0, CLUSTER_LIMITS.insightEvidenceCap);
  return [...reviews, ...gaps];
}

function toReviewInput(
  review: ClusterTopicReviewsSelection,
  topicName: string
): InsightReviewInput {
  const parsed = parseReview(review.review_json);
  const sections: Record<string, string> = {};
  if (parsed) {
    for (const [key, value] of Object.entries(parsed.sections)) {
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
