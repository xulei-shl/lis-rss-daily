/**
 * 主题仓储（cluster_topics）。
 *
 * 注意：`linked_count` / `primary_count` 由 links 层刷新（refreshTopicCounts），
 * 本文件只提供读写与状态维护，不自行推导计数，避免两处口径不一致。
 */

import { getDb, type ClusterTopicsSelection } from '../../db.js';

export type TopicStatus = 'NEW' | 'ACTIVE' | 'DORMANT' | 'ARCHIVED';

export interface TopicInsertInput {
  userId: number;
  setVersion: number;
  slug: string;
  name: string;
  keywords: string[];
  centroid: Buffer;
  centroidDim: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
}

export async function insertTopic(input: TopicInsertInput): Promise<number> {
  const result = await getDb()
    .insertInto('cluster_topics')
    .values({
      user_id: input.userId,
      set_version: input.setVersion,
      slug: input.slug,
      name: input.name,
      keywords: JSON.stringify(input.keywords),
      status: 'NEW',
      centroid: input.centroid,
      centroid_dim: input.centroidDim,
      first_event_date: input.firstEventDate,
      last_event_date: input.lastEventDate,
      is_dirty: 1,
      updated_at: new Date().toISOString(),
    })
    .executeTakeFirst();

  return Number(result.insertId);
}

/** 某版本下的主题总数（用于生成连续且不重复的 slug 序号） */
export async function countTopicsInVersion(setVersion: number): Promise<number> {
  const row = await getDb()
    .selectFrom('cluster_topics')
    .where('set_version', '=', setVersion)
    .select((eb) => eb.fn.count('id').as('count'))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function getTopicById(topicId: number): Promise<ClusterTopicsSelection | undefined> {
  return getDb()
    .selectFrom('cluster_topics')
    .selectAll()
    .where('id', '=', topicId)
    .executeTakeFirst();
}

export async function getTopicBySlug(
  setVersion: number,
  slug: string
): Promise<ClusterTopicsSelection | undefined> {
  return getDb()
    .selectFrom('cluster_topics')
    .selectAll()
    .where('set_version', '=', setVersion)
    .where('slug', '=', slug)
    .executeTakeFirst();
}

/** 某版本下可参与路由的主题（NEW/ACTIVE） */
export async function listRoutableTopics(setVersion: number): Promise<ClusterTopicsSelection[]> {
  return getDb()
    .selectFrom('cluster_topics')
    .selectAll()
    .where('set_version', '=', setVersion)
    .where('status', 'in', ['NEW', 'ACTIVE'])
    .orderBy('id', 'asc')
    .execute();
}

export async function listTopicsByVersion(setVersion: number): Promise<ClusterTopicsSelection[]> {
  return getDb()
    .selectFrom('cluster_topics')
    .selectAll()
    .where('set_version', '=', setVersion)
    .orderBy('id', 'asc')
    .execute();
}

/** 待重算多维分析的主题 */
export async function listDirtyTopics(setVersion: number): Promise<ClusterTopicsSelection[]> {
  return getDb()
    .selectFrom('cluster_topics')
    .selectAll()
    .where('set_version', '=', setVersion)
    .where('is_dirty', '=', 1)
    .orderBy('id', 'asc')
    .execute();
}

export async function updateTopicCentroid(
  topicId: number,
  centroid: Buffer,
  dim: number
): Promise<void> {
  await getDb()
    .updateTable('cluster_topics')
    .set({ centroid, centroid_dim: dim, updated_at: new Date().toISOString() })
    .where('id', '=', topicId)
    .execute();
}

export async function updateTopicIdentity(
  topicId: number,
  name: string,
  keywords: string[]
): Promise<void> {
  await getDb()
    .updateTable('cluster_topics')
    .set({ name, keywords: JSON.stringify(keywords), updated_at: new Date().toISOString() })
    .where('id', '=', topicId)
    .execute();
}

export async function updateTopicDates(
  topicId: number,
  firstEventDate: string | null,
  lastEventDate: string | null
): Promise<void> {
  await getDb()
    .updateTable('cluster_topics')
    .set({
      first_event_date: firstEventDate,
      last_event_date: lastEventDate,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', topicId)
    .execute();
}

export async function setTopicStatus(topicId: number, status: TopicStatus): Promise<void> {
  await getDb()
    .updateTable('cluster_topics')
    .set({ status, updated_at: new Date().toISOString() })
    .where('id', '=', topicId)
    .execute();
}

export async function markTopicDirty(topicId: number): Promise<void> {
  await getDb()
    .updateTable('cluster_topics')
    .set({ is_dirty: 1, updated_at: new Date().toISOString() })
    .where('id', '=', topicId)
    .execute();
}

export async function clearTopicDirty(topicId: number, analyzedAt: string): Promise<void> {
  await getDb()
    .updateTable('cluster_topics')
    .set({ is_dirty: 0, last_analyzed_at: analyzedAt, updated_at: analyzedAt })
    .where('id', '=', topicId)
    .execute();
}

/** 重置某版本的周期新增计数（每轮流水线开始时调用） */
export async function resetPeriodAddedCount(setVersion: number): Promise<void> {
  await getDb()
    .updateTable('cluster_topics')
    .set({ period_added_count: 0 })
    .where('set_version', '=', setVersion)
    .execute();
}
