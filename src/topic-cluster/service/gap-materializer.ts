/**
 * 研究空白物化：把阶段 B 产出的 gaps 写成 cluster_topic_gaps 行。
 *
 * 为什么需要物化：
 *   - 主题内二次聚类需要稳定 id 与向量，不能反复从 analysis_json 反序列化；
 *   - 洞察报告需要回链到具体空白，JSON 内联数组没有稳定身份。
 *
 * 向量复用证据文献的切面向量质心，不额外调用 embedding 模型。
 */

import type { AnalysisGap } from '../llm/analysis.js';
import { CLUSTER_CONFIG } from '../config.js';
import { groupSubtopics } from '../domain/chaining.js';
import { shortHash } from '../domain/hash.js';
import { blobToVector, centroidOf, dotNormalized, vectorToBlob } from '../domain/vector.js';
import { listFacetsByArticleIds } from '../repo/facets.js';
import { replaceTopicGaps, type GapWriteRow } from '../repo/gaps.js';
import type { TopicMemberView } from './member-view.js';

export interface MaterializeGapsInput {
  userId: number;
  setVersion: number;
  topicId: number;
  gaps: AnalysisGap[];
  members: TopicMemberView[];
  topicCentroid: Float32Array | null;
  sourceAnalysisHash: string;
}

export async function materializeTopicGaps(input: MaterializeGapsInput): Promise<number> {
  if (input.gaps.length === 0) {
    await replaceTopicGaps(input.topicId, []);
    return 0;
  }

  const evidenceIds = [...new Set(input.gaps.flatMap((gap) => gap.evidenceArticleIds))];
  const facets = await listFacetsByArticleIds(evidenceIds);
  const vectorById = new Map<number, Float32Array>();
  for (const member of input.members) vectorById.set(member.articleId, member.vector);

  for (const facet of facets) {
    if (!vectorById.has(facet.article_id)) {
      vectorById.set(facet.article_id, blobToVector(facet.embedding));
    }
  }

  // 划分二级子课题分面，以便将空白精准挂载到所属的专门子课题
  const subtopics = input.members.length > 0
    ? groupSubtopics(
        input.members.map((m) => ({
          articleId: m.articleId,
          vector: m.vector,
          eventDate: m.eventDate,
          precision: m.precision,
          methodKeys: m.methodKeys,
          objectKeys: m.objectKeys,
        })),
        CLUSTER_CONFIG.subtopicThreshold
      )
    : [];

  const subtopicMemberSets = subtopics.map((s) => ({
    key: s.subtopicKey,
    centroid: s.centroid,
    memberIds: new Set(s.members.map((m) => m.articleId)),
  }));

  const rows: GapWriteRow[] = input.gaps.map((gap) => {
    const vectors = gap.evidenceArticleIds
      .map((id) => vectorById.get(id))
      .filter((vector): vector is Float32Array => Boolean(vector));
    const embedding =
      vectors.length > 0
        ? centroidOf(vectors)
        : input.topicCentroid;
    const gapKey = `gp-${shortHash(normalizeGap(gap.gap), 10)}`;

    // 确定所属子课题分面（优先依据证据文献包含数，次之依据质心相似度）
    let assignedSubtopicKey: string | null = null;
    let maxEvidenceMatch = 0;

    for (const sub of subtopicMemberSets) {
      let matchCount = 0;
      for (const id of gap.evidenceArticleIds) {
        if (sub.memberIds.has(id)) matchCount += 1;
      }
      if (matchCount > maxEvidenceMatch) {
        maxEvidenceMatch = matchCount;
        assignedSubtopicKey = sub.key;
      }
    }

    if (!assignedSubtopicKey && embedding && subtopicMemberSets.length > 0) {
      let bestSim = -Infinity;
      let bestKey: string | null = null;
      for (const sub of subtopicMemberSets) {
        const sim = dotNormalized(embedding, sub.centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestKey = sub.key;
        }
      }
      if (bestSim >= CLUSTER_CONFIG.subtopicThreshold) {
        assignedSubtopicKey = bestKey;
      }
    }

    return {
      userId: input.userId,
      setVersion: input.setVersion,
      topicId: input.topicId,
      gapKey,
      subtopicKey: assignedSubtopicKey,
      gap: gap.gap,
      basis: gap.basis,
      method: gap.method ?? null,
      object: gap.object ?? null,
      evidenceIds: gap.evidenceArticleIds,
      embedding: embedding ? vectorToBlob(embedding) : null,
      embeddingDim: embedding ? embedding.length : null,
      sourceAnalysisHash: input.sourceAnalysisHash,
    };
  });

  await replaceTopicGaps(input.topicId, rows);
  return rows.length;
}

function normalizeGap(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '');
}
