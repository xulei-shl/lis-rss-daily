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
import { shortHash } from '../domain/hash.js';
import { blobToVector, centroidOf, vectorToBlob } from '../domain/vector.js';
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

  const rows: GapWriteRow[] = input.gaps.map((gap) => {
    const vectors = gap.evidenceArticleIds
      .map((id) => vectorById.get(id))
      .filter((vector): vector is Float32Array => Boolean(vector));
    const embedding =
      vectors.length > 0
        ? centroidOf(vectors)
        : input.topicCentroid;
    const gapKey = `gp-${shortHash(normalizeGap(gap.gap), 10)}`;

    return {
      userId: input.userId,
      setVersion: input.setVersion,
      topicId: input.topicId,
      gapKey,
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
