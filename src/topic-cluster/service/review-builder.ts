/**
 * 深度综述的规则层（零 token）：角度簇合并 + 证据包。
 *
 * 与多维分析的分工：
 *   - `paradigmReviews` 是「方法 × 对象」矩阵域的短微综述；
 *   - 本模块把**已有的角度簇**按质心合并成更大的综述组，每群生成一篇长篇综述。
 *
 * 为什么不再独立聚类成员：角度已经是主题内唯一的语义子域划分。若综述层再按
 * 0.7 阈值切一次，同一篇文献会在「演进脉络」和「深度综述」里落到不同子域，
 * 前端无法解释。现在综述组只能是角度组的**并集**，不会拆开任何角度。
 *
 * LLM 不参与分群：簇、代表文献与证据白名单都由规则先行确定，模型只负责写作。
 */

import { CLUSTER_CONFIG, CLUSTER_LIMITS } from '../config.js';
import { groupAngles, type AngleGroup, type ChainItem } from '../domain/chaining.js';
import { cohesionClusters } from '../domain/clustering.js';
import { shortHash } from '../domain/hash.js';
import { dotNormalized } from '../domain/vector.js';
import type { ArticleBrief } from '../source.js';
import type { EvidencePack } from './analysis-payload.js';
import type { TopicMemberView } from './member-view.js';

export interface ReviewGroup {
  /** 首次生成时的稳定身份（核心锚点哈希） */
  key: string;
  memberIds: number[];
  representativeIds: number[];
  /** 已归一化的群质心，供洞察层二次聚类 */
  centroid: Float32Array;
  evidence: EvidencePack[];
  statsText: string;
  /** 全成员切面签名，用于增量重算判定（非代表成员变化也要触发） */
  facetSignature: string;
}

const MAX_SUMMARY_CHARS = 800;

export function buildReviewGroups(
  members: TopicMemberView[],
  briefs: Map<number, ArticleBrief>
): ReviewGroup[] {
  if (members.length < CLUSTER_LIMITS.reviewMinMembers) return [];

  // 复用角度分区：综述层只能合并角度，不能重新切分成员。
  const angleGroups = groupAngles(
    members.map(toChainItem),
    CLUSTER_CONFIG.angleThreshold,
    { maxAngleCount: CLUSTER_LIMITS.maxAngleCount }
  );

  const targetCount = clamp(
    Math.ceil(members.length / 12),
    2,
    CLUSTER_LIMITS.reviewMaxGroups
  );
  const { components } = cohesionClusters(
    angleGroups.map((angle, index) => ({ id: index, vector: angle.centroid })),
    CLUSTER_LIMITS.reviewClusterThreshold,
    { minSize: 1, linkage: 'average', targetCount }
  );

  const angleIndexGroups = capReviewGroupCount(
    components.map((component) => [...component.ids]),
    angleGroups,
    CLUSTER_LIMITS.reviewMaxGroups
  );

  const memberMap = new Map(members.map((member) => [member.articleId, member]));
  const groups: ReviewGroup[] = [];

  for (const angleIndices of angleIndexGroups) {
    const groupMembers = angleIndices.flatMap((index) =>
      angleGroups[index].members
        .map((item) => memberMap.get(item.articleId))
        .filter((member): member is TopicMemberView => Boolean(member))
    );
    // 与旧行为一致：证据不足的综述组跳过，但绝不会把它拆到别的角度里。
    if (groupMembers.length < CLUSTER_LIMITS.reviewMinMembers) continue;
    groups.push(
      buildGroup(
        groupMembers,
        centroidOf(groupMembers.map((member) => member.vector)),
        briefs
      )
    );
  }

  // 低于阈值导致一簇都聚不出时，退化为「整主题一篇综述」，
  // 而不是让中等规模主题完全没有深度综述。
  if (groups.length === 0) {
    const centroid = centroidOf(members.map((member) => member.vector));
    groups.push(buildGroup(members, centroid, briefs));
  }

  return groups
    .sort((a, b) => b.memberIds.length - a.memberIds.length || a.key.localeCompare(b.key))
    .slice(0, CLUSTER_LIMITS.reviewMaxGroups);
}

function toChainItem(member: TopicMemberView): ChainItem {
  return {
    articleId: member.articleId,
    vector: member.vector,
    eventDate: member.eventDate,
    precision: member.precision,
    methodKeys: member.methodKeys,
    objectKeys: member.objectKeys,
  };
}

/** 综述组超过上限时合并质心最近的两组；仍是角度并集，不拆成员。 */
function capReviewGroupCount(
  groups: number[][],
  angles: AngleGroup[],
  limit: number
): number[][] {
  while (groups.length > limit) {
    let bestA = 0;
    let bestB = 1;
    let bestSimilarity = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const similarity = dotNormalized(
          groupCentroid(groups[i], angles),
          groupCentroid(groups[j], angles)
        );
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestA = i;
          bestB = j;
        }
      }
    }

    groups[bestA] = [...groups[bestA], ...groups[bestB]];
    groups.splice(bestB, 1);
  }
  return groups;
}

function groupCentroid(indices: number[], angles: AngleGroup[]): Float32Array {
  return centroidOf(
    indices.flatMap((index) => angles[index].members.map((member) => member.vector))
  );
}

function buildGroup(
  members: TopicMemberView[],
  centroid: Float32Array,
  briefs: Map<number, ArticleBrief>
): ReviewGroup {
  const scored = [...members].sort(
    (a, b) =>
      dotNormalized(b.vector, centroid) - dotNormalized(a.vector, centroid) ||
      a.articleId - b.articleId
  );

  // 深度综述需要足够证据：核心取到证据上限减 2，剩余名额留给最新/异质文献。
  const core = scored.slice(
    0,
    Math.min(CLUSTER_LIMITS.reviewEvidenceCap - 2, scored.length)
  );
  const newest = [...members]
    .filter((member) => Boolean(member.eventDate))
    .sort((a, b) => (b.eventDate ?? '').localeCompare(a.eventDate ?? ''))[0];
  const outlier = scored[scored.length - 1];

  const selected = uniqueMembers([...core, ...(newest ? [newest] : []), ...(outlier ? [outlier] : [])])
    .slice(0, CLUSTER_LIMITS.reviewEvidenceCap);

  const evidence = selected.map((member) => toEvidencePack(member, briefs.get(member.articleId)));
  const anchor = core
    .slice(0, 3)
    .map((member) => member.articleId)
    .sort((a, b) => a - b);

  return {
    key: `rv-${shortHash(anchor.join(','), 10)}`,
    memberIds: members.map((member) => member.articleId).sort((a, b) => a - b),
    representativeIds: selected.map((member) => member.articleId),
    centroid,
    evidence,
    statsText: renderGroupStats(members),
    facetSignature: members
      .map(
        (member) =>
          `${member.articleId}:${member.facet.research_question}|${member.facet.method}|` +
          `${member.facet.study_object}|${member.facet.core_finding}|${member.facet.limitation ?? ''}`
      )
      .join('||'),
  };
}

function renderGroupStats(members: TopicMemberView[]): string {
  const methods = topCounts(members.map((member) => member.facet.method), 4);
  const objects = topCounts(members.map((member) => member.facet.study_object), 4);
  const dates = members
    .map((member) => member.eventDate)
    .filter((date): date is string => Boolean(date))
    .sort();

  return [
    `文献数：${members.length}`,
    dates.length > 0 ? `时间范围：${dates[0]} ~ ${dates[dates.length - 1]}` : '时间范围：未知',
    methods.length > 0 ? `主要方法：${methods.join('、')}` : '',
    objects.length > 0 ? `主要研究对象：${objects.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('；');
}

function toEvidencePack(member: TopicMemberView, brief: ArticleBrief | undefined): EvidencePack {
  const year =
    brief?.publishedYear ??
    (member.eventDate ? Number(member.eventDate.slice(0, 4)) : null);
  return {
    articleId: member.articleId,
    title: truncate(brief?.title ?? '', 100),
    year: Number.isFinite(year ?? NaN) ? year : null,
    researchQuestion: truncate(member.facet.research_question, 140),
    method: truncate(member.facet.method, 60),
    studyObject: truncate(member.facet.study_object, 80),
    coreFinding: truncate(member.facet.core_finding, 140),
    limitation: member.facet.limitation ? truncate(member.facet.limitation, 120) : null,
    evidenceQuotes: (member.facet.evidence_quotes ?? []).slice(0, 2).map((quote) => truncate(quote, 140)),
    summaryExcerpt: truncate(brief?.aiSummary ?? '', MAX_SUMMARY_CHARS),
  };
}

/** 集合 Jaccard，用于增量匹配综述/报告身份 */
export function jaccard(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const left = new Set(a);
  const right = new Set(b);
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function isSubset(subset: readonly number[], superset: readonly number[]): boolean {
  const target = new Set(superset);
  return subset.every((value) => target.has(value));
}

function uniqueMembers(members: TopicMemberView[]): TopicMemberView[] {
  const seen = new Set<number>();
  const out: TopicMemberView[] = [];
  for (const member of members) {
    if (seen.has(member.articleId)) continue;
    seen.add(member.articleId);
    out.push(member);
  }
  return out;
}

function topCounts(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function centroidOf(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0);
  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i += 1) sum[i] += vector[i];
  }
  let norm = 0;
  for (let i = 0; i < dim; i += 1) {
    sum[i] /= vectors.length;
    norm += sum[i] * sum[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i += 1) sum[i] /= norm;
  return sum;
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
