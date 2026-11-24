/**
 * 深度综述仓储（cluster_topic_reviews）。
 *
 * 身份与成员解耦：`review_key` 在首次生成时由核心锚点决定，之后成员新增/流失
 * 通过 Jaccard 匹配续写同一行，不产生重复综述。被替代的旧行保留为 `superseded`，
 * 供历史追溯与旧洞察报告回链。
 */

import { getDb, type ClusterTopicReviewsSelection } from '../../db.js';

export interface ReviewWriteRow {
  userId: number;
  setVersion: number;
  topicId: number;
  reviewKey: string;
  title: string;
  abstract: string;
  reviewJson: string;
  memberIds: number[];
  representativeIds: number[];
  centroid: Buffer | null;
  centroidDim: number | null;
  inputHash: string;
  linkedCount: number;
  status: 'ok' | 'partial' | 'failed' | 'superseded';
  supersedesId: number | null;
}

export async function insertReview(row: ReviewWriteRow): Promise<number> {
  const now = new Date().toISOString();
  const result = await getDb()
    .insertInto('cluster_topic_reviews')
    .values({
      user_id: row.userId,
      set_version: row.setVersion,
      topic_id: row.topicId,
      review_key: row.reviewKey,
      title: row.title,
      abstract: row.abstract,
      review_json: row.reviewJson,
      member_ids_json: JSON.stringify(row.memberIds),
      representative_ids_json: JSON.stringify(row.representativeIds),
      centroid: row.centroid,
      centroid_dim: row.centroidDim,
      input_hash: row.inputHash,
      linked_count: row.linkedCount,
      status: row.status,
      supersedes_id: row.supersedesId,
      version: 1,
      generated_at: now,
      updated_at: now,
    })
    .executeTakeFirst();
  return Number(result.insertId);
}

export async function updateReview(
  id: number,
  row: Omit<ReviewWriteRow, 'reviewKey'> & { version: number }
): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .updateTable('cluster_topic_reviews')
    .set({
      title: row.title,
      abstract: row.abstract,
      review_json: row.reviewJson,
      member_ids_json: JSON.stringify(row.memberIds),
      representative_ids_json: JSON.stringify(row.representativeIds),
      centroid: row.centroid,
      centroid_dim: row.centroidDim,
      input_hash: row.inputHash,
      linked_count: row.linkedCount,
      status: row.status,
      supersedes_id: row.supersedesId,
      version: row.version,
      generated_at: now,
      updated_at: now,
    })
    .where('id', '=', id)
    .execute();
}

export async function supersedeReview(id: number, supersededBy: number | null = null): Promise<void> {
  await getDb()
    .updateTable('cluster_topic_reviews')
    .set({
      status: 'superseded',
      supersedes_id: supersededBy,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .where('status', '!=', 'superseded')
    .execute();
}

/** 主题内非 superseded 的综述（用于增量匹配） */
export async function listActiveReviewsByTopic(topicId: number): Promise<ClusterTopicReviewsSelection[]> {
  return getDb()
    .selectFrom('cluster_topic_reviews')
    .selectAll()
    .where('topic_id', '=', topicId)
    .where('status', '!=', 'superseded')
    .orderBy('id', 'asc')
    .execute();
}

/** 某版本下可参与二次聚类的综述 */
export async function listActiveReviewsBySet(setVersion: number): Promise<ClusterTopicReviewsSelection[]> {
  return getDb()
    .selectFrom('cluster_topic_reviews')
    .selectAll()
    .where('set_version', '=', setVersion)
    .where('status', '=', 'ok')
    .where('centroid', 'is not', null)
    .orderBy('id', 'asc')
    .execute();
}

export async function getReviewByKey(
  topicId: number,
  reviewKey: string
): Promise<ClusterTopicReviewsSelection | undefined> {
  return getDb()
    .selectFrom('cluster_topic_reviews')
    .selectAll()
    .where('topic_id', '=', topicId)
    .where('review_key', '=', reviewKey)
    .executeTakeFirst();
}

export async function getReviewById(id: number): Promise<ClusterTopicReviewsSelection | undefined> {
  return getDb()
    .selectFrom('cluster_topic_reviews')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}

export async function listReviewsByTopic(topicId: number): Promise<ClusterTopicReviewsSelection[]> {
  return getDb()
    .selectFrom('cluster_topic_reviews')
    .selectAll()
    .where('topic_id', '=', topicId)
    .where('status', '!=', 'superseded')
    .orderBy('linked_count', 'desc')
    .orderBy('id', 'asc')
    .execute();
}

/** 每个主题当前 ok 综述数（执行日志的前后差值用） */
export async function countReviewsByTopic(setVersion: number): Promise<Map<number, number>> {
  const rows = await getDb()
    .selectFrom('cluster_topic_reviews')
    .select((eb) => ['topic_id as topic_id', eb.fn.count('id').as('count')])
    .where('set_version', '=', setVersion)
    .where('status', '=', 'ok')
    .groupBy('topic_id')
    .execute();

  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.topic_id, Number(row.count));
  return counts;
}

/**
 * 微主题整合时把综述改挂到吸收方，并保留历史。
 *
 * 不删除行：旧洞察报告里的 review id 仍可回溯。review_key 加旧主题后缀，
 * 避免与目标主题已有 key 冲突。
 */
export async function remapReviewsToTopic(oldTopicId: number, targetTopicId: number): Promise<void> {
  const db = getDb();
  const rows = await db
    .selectFrom('cluster_topic_reviews')
    .select(['id', 'review_key'])
    .where('topic_id', '=', oldTopicId)
    .execute();

  for (const row of rows) {
    await db
      .updateTable('cluster_topic_reviews')
      .set({
        topic_id: targetTopicId,
        review_key: `${row.review_key}-m${oldTopicId}`,
        status: 'superseded',
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', row.id)
      .execute();
  }
}
