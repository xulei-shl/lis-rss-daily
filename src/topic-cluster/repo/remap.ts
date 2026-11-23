/**
 * 跨版本主题重定向（cluster_topic_remap）。
 *
 * 重建主题集合后，旧 slug 不能 404：按质心余弦把每个旧主题映射到最相似的新主题。
 * 只写一条最佳匹配；低于阈值的不写，避免把无关主题错误重定向。
 */

import { getDb } from '../../db.js';
import { blobToVector, cosine } from '../domain/vector.js';
import { listTopicsByVersion } from './topics.js';

export interface RemapRow {
  oldTopicId: number;
  newTopicId: number;
  similarity: number;
}

/** 按质心余弦为两个版本建立 remap；返回写入条数。 */
export async function writeRemapForVersions(
  fromVersion: number,
  toVersion: number,
  threshold = 0.72
): Promise<number> {
  const [oldTopics, newTopics] = await Promise.all([
    listTopicsByVersion(fromVersion),
    listTopicsByVersion(toVersion),
  ]);
  if (oldTopics.length === 0 || newTopics.length === 0) return 0;

  const rows: RemapRow[] = [];
  for (const oldTopic of oldTopics) {
    if (!oldTopic.centroid) continue;
    const best = pickBestTopic(
      blobToVector(oldTopic.centroid),
      newTopics
        .filter((topic) => topic.centroid)
        .map((topic) => ({ topicId: topic.id, vector: blobToVector(topic.centroid!) })),
      threshold
    );
    if (best) {
      rows.push({
        oldTopicId: oldTopic.id,
        newTopicId: best.topicId,
        similarity: best.similarity,
      });
    }
  }

  const db = getDb();
  await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom('cluster_topic_remap')
      .where('from_version', '=', fromVersion)
      .where('to_version', '=', toVersion)
      .execute();
    if (rows.length === 0) return;
    await trx
      .insertInto('cluster_topic_remap')
      .values(
        rows.map((row) => ({
          old_topic_id: row.oldTopicId,
          new_topic_id: row.newTopicId,
          similarity: row.similarity,
          from_version: fromVersion,
          to_version: toVersion,
        }))
      )
      .execute();
  });

  return rows.length;
}

/** 选出最相似且达到阈值的新主题；低于阈值返回 null。 */
export function pickBestTopic(
  oldVector: Float32Array,
  candidates: Array<{ topicId: number; vector: Float32Array }>,
  threshold = 0.72
): { topicId: number; similarity: number } | null {
  let best: { topicId: number; similarity: number } | null = null;
  for (const candidate of candidates) {
    const similarity = cosine(oldVector, candidate.vector);
    if (!best || similarity > best.similarity) {
      best = { topicId: candidate.topicId, similarity };
    }
  }
  return best && best.similarity >= threshold ? best : null;
}

/** 旧主题 → 新主题（若有 remap） */
export async function getRemappedTopicId(oldTopicId: number): Promise<number | null> {
  const row = await getDb()
    .selectFrom('cluster_topic_remap')
    .select('new_topic_id')
    .where('old_topic_id', '=', oldTopicId)
    .orderBy('similarity', 'desc')
    .executeTakeFirst();
  return row ? Number(row.new_topic_id) : null;
}

/** 跨版本按 slug 找旧主题；用于 active 版本查不到时的回退。 */
export async function findTopicIdBySlugAnyVersion(slug: string): Promise<number | null> {
  const row = await getDb()
    .selectFrom('cluster_topics')
    .select('id')
    .where('slug', '=', slug)
    .orderBy('set_version', 'desc')
    .executeTakeFirst();
  return row ? Number(row.id) : null;
}
