/**
 * 主题内洞察报告仓储（cluster_insight_reports）。
 *
 * 报告只属于一个大主题，身份与成员解耦：`report_key` 由核心节点决定，
 * 后续成员变化按 Jaccard 续写同一行；被替代的报告保留为 `superseded`。
 */

import { getDb, type ClusterInsightReportsSelection } from '../../db.js';

export interface InsightMemberRef {
  kind: 'review' | 'gap';
  id: number;
  topicId: number;
}

export interface InsightWriteRow {
  userId: number;
  setVersion: number;
  topicId: number;
  reportKey: string;
  title: string;
  reportJson: string;
  memberRefs: InsightMemberRef[];
  topicIds: number[];
  centroid: Buffer | null;
  centroidDim: number | null;
  inputHash: string;
  status: 'ok' | 'failed' | 'superseded';
  supersedesId: number | null;
}

export function refKey(ref: InsightMemberRef): string {
  return `${ref.kind}:${ref.id}`;
}

export async function insertInsightReport(row: InsightWriteRow): Promise<number> {
  const now = new Date().toISOString();
  const result = await getDb()
    .insertInto('cluster_insight_reports')
    .values({
      user_id: row.userId,
      set_version: row.setVersion,
      topic_id: row.topicId,
      report_key: row.reportKey,
      title: row.title,
      report_json: row.reportJson,
      member_refs_json: JSON.stringify(row.memberRefs),
      topic_ids_json: JSON.stringify(row.topicIds),
      centroid: row.centroid,
      centroid_dim: row.centroidDim,
      input_hash: row.inputHash,
      status: row.status,
      supersedes_id: row.supersedesId,
      version: 1,
      generated_at: now,
      updated_at: now,
    })
    .executeTakeFirst();
  return Number(result.insertId);
}

export async function updateInsightReport(
  id: number,
  row: Omit<InsightWriteRow, 'reportKey'> & { version: number }
): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .updateTable('cluster_insight_reports')
    .set({
      topic_id: row.topicId,
      title: row.title,
      report_json: row.reportJson,
      member_refs_json: JSON.stringify(row.memberRefs),
      topic_ids_json: JSON.stringify(row.topicIds),
      centroid: row.centroid,
      centroid_dim: row.centroidDim,
      input_hash: row.inputHash,
      status: row.status,
      supersedes_id: row.supersedesId,
      version: row.version,
      generated_at: now,
      updated_at: now,
    })
    .where('id', '=', id)
    .execute();
}

export async function supersedeInsightReport(
  id: number,
  supersededBy: number | null = null
): Promise<void> {
  await getDb()
    .updateTable('cluster_insight_reports')
    .set({
      status: 'superseded',
      supersedes_id: supersededBy,
      updated_at: new Date().toISOString(),
    })
    .where('id', '=', id)
    .where('status', '!=', 'superseded')
    .execute();
}

/** 当前版本的非 superseded 报告（ok + failed，failed 允许下轮重试） */
export async function listActiveInsightReports(
  setVersion: number
): Promise<ClusterInsightReportsSelection[]> {
  return getDb()
    .selectFrom('cluster_insight_reports')
    .selectAll()
    .where('set_version', '=', setVersion)
    .where('status', '!=', 'superseded')
    .orderBy('id', 'asc')
    .execute();
}

export async function listPublishedInsightReports(
  setVersion: number
): Promise<ClusterInsightReportsSelection[]> {
  return getDb()
    .selectFrom('cluster_insight_reports')
    .selectAll()
    .where('set_version', '=', setVersion)
    .where('status', '=', 'ok')
    .orderBy('updated_at', 'desc')
    .execute();
}

export async function getInsightReportByKey(
  setVersion: number,
  topicId: number,
  reportKey: string
): Promise<ClusterInsightReportsSelection | undefined> {
  return getDb()
    .selectFrom('cluster_insight_reports')
    .selectAll()
    .where('set_version', '=', setVersion)
    .where('topic_id', '=', topicId)
    .where('report_key', '=', reportKey)
    .executeTakeFirst();
}

/** 主题被合并后，其主题内洞察不再成立，保留审计但置为 superseded */
export async function supersedeInsightReportsForTopic(topicId: number): Promise<void> {
  await getDb()
    .updateTable('cluster_insight_reports')
    .set({
      status: 'superseded',
      updated_at: new Date().toISOString(),
    })
    .where('topic_id', '=', topicId)
    .where('status', '!=', 'superseded')
    .execute();
}

export async function getInsightReportById(
  id: number
): Promise<ClusterInsightReportsSelection | undefined> {
  return getDb()
    .selectFrom('cluster_insight_reports')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}
