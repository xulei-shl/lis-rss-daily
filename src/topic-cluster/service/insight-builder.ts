/**
 * 跨主题洞察的规则层（零 token）：综述 + 研究空白二次聚类。
 *
 * 节点向量全部复用已有产物：
 *   - 综述 → 子簇质心；
 *   - 空白 → 证据文献切面的质心。
 * 因此二次聚类不产生任何 embedding 调用。
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

export interface BuildInsightClustersInput {
  reviews: ClusterTopicReviewsSelection[];
  gaps: ClusterTopicGapsSelection[];
  topics: ClusterTopicsSelection[];
}

export function buildInsightClusters(input: BuildInsightClustersInput): InsightCluster[] {
  const topicsById = new Map(input.topics.map((topic) => [topic.id, topic]));
  const topicName = (topicId: number) => topicsById.get(topicId)?.name ?? `主题 #${topicId}`;

  const nodes: Node[] = [];
  for (const review of input.reviews) {
    if (!review.centroid) continue;
    nodes.push({
      ref: { kind: 'review', id: review.id, topicId: review.topic_id },
      vector: blobToVector(review.centroid),
    });
  }
  for (const gap of input.gaps) {
    if (!gap.embedding) continue;
    nodes.push({
      ref: { kind: 'gap', id: gap.id, topicId: gap.topic_id },
      vector: blobToVector(gap.embedding),
    });
  }

  if (nodes.length < CLUSTER_LIMITS.insightMinNodes) return [];

  const targetCount = clamp(
    Math.ceil(nodes.length / 6),
    3,
    CLUSTER_LIMITS.insightMaxReports
  );
  const { components } = cohesionClusters(
    nodes.map((node, index) => ({ id: index, vector: node.vector })),
    CLUSTER_LIMITS.insightClusterThreshold,
    { minSize: CLUSTER_LIMITS.insightMinNodes, linkage: 'average', targetCount }
  );

  const reviewById = new Map(input.reviews.map((review) => [review.id, review]));
  const gapById = new Map(input.gaps.map((gap) => [gap.id, gap]));
  const clusters: InsightCluster[] = [];

  for (const component of components) {
    const componentNodes = component.ids
      .map((index) => nodes[index])
      .filter((node): node is Node => Boolean(node));

    const topicIds = [...new Set(componentNodes.map((node) => node.ref.topicId))];
    const reviewNodes = componentNodes.filter((node) => node.ref.kind === 'review');
    // 单主题簇或没有综述的纯空白簇不是「跨主题洞察」。
    if (topicIds.length < 2 || reviewNodes.length < CLUSTER_LIMITS.insightMinReviews) continue;

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
      .map((review) => toReviewInput(review, topicName(review.topic_id)));

    const gaps = selected
      .filter((node) => node.ref.kind === 'gap')
      .map((node) => gapById.get(node.ref.id))
      .filter((gap): gap is ClusterTopicGapsSelection => Boolean(gap))
      .map((gap) => ({
        id: gap.id,
        gap: gap.gap,
        basis: gap.basis,
        topicName: topicName(gap.topic_id),
        method: gap.method,
        object: gap.object,
      }));

    clusters.push({
      key: `ins-${shortHash(anchor.join('|'), 10)}`,
      refs,
      topicIds,
      centroid: component.centroid,
      scope: topicIds.map(topicName).join('、'),
      reviews,
      gaps,
    });
  }

  return clusters.sort(
    (a, b) => b.refs.length - a.refs.length || a.key.localeCompare(b.key)
  );
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
