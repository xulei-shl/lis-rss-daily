/**
 * 物化研究空白仓储（cluster_topic_gaps）。
 *
 * 空白原本只存在于 `cluster_topic_analysis.analysis_json`，主题内二次聚类需要稳定 id
 * 与向量，因此在阶段 B 成功后物化一份。`gap_key` 在同一主题内由空白文本决定，
 * 重算时 upsert 而不是删了重插，旧洞察报告仍能回链。
 */

import { getDb, type ClusterTopicGapsSelection } from '../../db.js';

export type GapScope = 'topic' | 'subtopic';

export interface GapWriteRow {
  userId: number;
  setVersion: number;
  topicId: number;
  gapKey: string;
  subtopicKey?: string | null;
  scope?: GapScope;
  gap: string;
  basis: string;
  method: string | null;
  object: string | null;
  evidenceIds: number[];
  embedding: Buffer | null;
  embeddingDim: number | null;
  sourceAnalysisHash: string;
}

/** 用本轮宏观空白整体替换主题的 active topic 级空白；不覆写 subtopic 独立分析空白 */
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
      .where('scope', '=', 'topic')
      .where('status', '=', 'active')
      .execute();

    for (const row of rows) {
      const scope = row.scope ?? 'topic';
      await trx
        .insertInto('cluster_topic_gaps')
        .values({
          user_id: row.userId,
          set_version: row.setVersion,
          topic_id: row.topicId,
          gap_key: row.gapKey,
          subtopic_key: row.subtopicKey ?? null,
          scope,
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
            scope,
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

/** 替换单个子课题的 active subtopic 级空白；不影响同主题其他子课题与宏观空白 */
export async function replaceSubtopicGaps(
  topicId: number,
  subtopicKey: string,
  rows: GapWriteRow[]
): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const keys = expandSubtopicKeys(subtopicKey);

  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('cluster_topic_gaps')
      .set({ status: 'superseded', updated_at: now })
      .where('topic_id', '=', topicId)
      .where('scope', '=', 'subtopic')
      .where('subtopic_key', 'in', keys)
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
          subtopic_key: subtopicKey,
          scope: 'subtopic',
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
            subtopic_key: subtopicKey,
            scope: 'subtopic',
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

/** 读取某个子课题当前 active 的 subtopic 级空白（用于 hash 缓存命中判定） */
export async function listActiveSubtopicGaps(
  topicId: number,
  subtopicKey: string
): Promise<ClusterTopicGapsSelection[]> {
  return getDb()
    .selectFrom('cluster_topic_gaps')
    .selectAll()
    .where('topic_id', '=', topicId)
    .where('scope', '=', 'subtopic')
    .where('subtopic_key', 'in', expandSubtopicKeys(subtopicKey))
    .where('status', '=', 'active')
    .orderBy('id', 'asc')
    .execute();
}

/** 将不再活跃的子课题空白置为 superseded（子课题被替换/主题缩小时调用） */
export async function supersedeSubtopicGaps(
  topicId: number,
  subtopicKeys?: readonly string[]
): Promise<void> {
  if (subtopicKeys && subtopicKeys.length === 0) return;
  let query = getDb()
    .updateTable('cluster_topic_gaps')
    .set({ status: 'superseded', updated_at: new Date().toISOString() })
    .where('topic_id', '=', topicId)
    .where('scope', '=', 'subtopic')
    .where('status', '=', 'active');

  if (subtopicKeys) {
    const expanded = [...new Set(subtopicKeys.flatMap((key) => expandSubtopicKeys(key)))];
    query = query.where('subtopic_key', 'in', expanded);
  }
  await query.execute();
}

function expandSubtopicKeys(subtopicKey: string): string[] {
  const norm = subtopicKey.replace(/^rv-/, '');
  return norm === subtopicKey ? [norm, `rv-${norm}`] : [norm, subtopicKey];
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
