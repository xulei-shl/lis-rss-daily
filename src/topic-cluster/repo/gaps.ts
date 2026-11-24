/**
 * 物化研究空白仓储（cluster_topic_gaps）。
 *
 * 空白原本只存在于 `cluster_topic_analysis.analysis_json`，主题内二次聚类需要稳定 id
 * 与向量，因此在阶段 B 成功后物化一份。`gap_key` 在同一主题内由空白文本决定，
 * 重算时 upsert 而不是删了重插，旧洞察报告仍能回链。
 */

import { getDb, type ClusterTopicGapsSelection } from '../../db.js';

export interface GapWriteRow {
  userId: number;
  setVersion: number;
  topicId: number;
  gapKey: string;
  subtopicKey?: string | null;
  gap: string;
  basis: string;
  method: string | null;
  object: string | null;
  evidenceIds: number[];
  embedding: Buffer | null;
  embeddingDim: number | null;
  sourceAnalysisHash: string;
}

/** 用本轮空白整体替换主题的 active 空白；未再出现的旧空白置为 superseded */
export async function replaceTopicGaps(
  topicId: number,
  rows: GapWriteRow[]
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('cluster_topic_gaps')
      .set({ status: 'superseded', updated_at: now })
      .where('topic_id', '=', topicId)
      .where('status', '=', 'active')
      .execute();

    for (const row of rows) {
      await trx
        .insertInto('cluster_topic_gaps')
        .values({
          user_id: row.userId,
          set_version: row.setVersion,
          topic_id: row.topicId,
          gap_key: row.gapKey,
          subtopic_key: row.subtopicKey ?? null,
          gap: row.gap,
          basis: row.basis,
          method: row.method,
          object: row.object,
          evidence_ids_json: JSON.stringify(row.evidenceIds),
          embedding: row.embedding,
          embedding_dim: row.embeddingDim,
          source_analysis_hash: row.sourceAnalysisHash,
          status: 'active',
          updated_at: now,
        })
        .onConflict((oc) =>
          oc.columns(['topic_id', 'gap_key']).doUpdateSet({
            subtopic_key: row.subtopicKey ?? null,
            gap: row.gap,
            basis: row.basis,
            method: row.method,
            object: row.object,
            evidence_ids_json: JSON.stringify(row.evidenceIds),
            embedding: row.embedding,
            embedding_dim: row.embeddingDim,
            source_analysis_hash: row.sourceAnalysisHash,
            status: 'active',
            updated_at: now,
          })
        )
        .execute();
    }
  });
}

export async function listActiveGapsBySet(setVersion: number): Promise<ClusterTopicGapsSelection[]> {
  return getDb()
    .selectFrom('cluster_topic_gaps')
    .selectAll()
    .where('set_version', '=', setVersion)
    .where('status', '=', 'active')
    .where('embedding', 'is not', null)
    .orderBy('id', 'asc')
    .execute();
}

export async function listActiveGapsByTopic(topicId: number): Promise<ClusterTopicGapsSelection[]> {
  return getDb()
    .selectFrom('cluster_topic_gaps')
    .selectAll()
    .where('topic_id', '=', topicId)
    .where('status', '=', 'active')
    .orderBy('id', 'asc')
    .execute();
}

export async function getGapsByIds(ids: number[]): Promise<ClusterTopicGapsSelection[]> {
  if (ids.length === 0) return [];
  return getDb()
    .selectFrom('cluster_topic_gaps')
    .selectAll()
    .where('id', 'in', ids)
    .execute();
}

/** 微主题整合：空白改挂到吸收方，旧行保留为 superseded */
export async function remapGapsToTopic(oldTopicId: number, targetTopicId: number): Promise<void> {
  const db = getDb();
  const rows = await db
    .selectFrom('cluster_topic_gaps')
    .select(['id', 'gap_key'])
    .where('topic_id', '=', oldTopicId)
    .execute();

  for (const row of rows) {
    await db
      .updateTable('cluster_topic_gaps')
      .set({
        topic_id: targetTopicId,
        gap_key: `${row.gap_key}-m${oldTopicId}`,
        status: 'superseded',
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', row.id)
      .execute();
  }
}
