/**
 * 主题洞察版本文件仓储（cluster_topic_documents）。
 *
 * 文件本体由 service/document-generator.ts 写入 data/cluster-documents/，
 * 本表只保存页面展示与下载所需的元数据。version 按主题独立递增。
 */

import { getDb, type ClusterTopicDocumentsSelection } from '../../db.js';

export interface DocumentWriteRow {
  userId: number;
  setVersion: number;
  topicId: number;
  version: number;
  filename: string;
  sizeBytes: number;
  contentHash: string;
}

export async function insertTopicDocument(row: DocumentWriteRow): Promise<number> {
  const result = await getDb()
    .insertInto('cluster_topic_documents')
    .values({
      user_id: row.userId,
      set_version: row.setVersion,
      topic_id: row.topicId,
      version: row.version,
      filename: row.filename,
      size_bytes: row.sizeBytes,
      content_hash: row.contentHash,
      created_at: new Date().toISOString(),
    })
    .executeTakeFirst();
  return Number(result.insertId);
}

/** 该主题的全部版本文件（最新在前） */
export async function listTopicDocuments(
  topicId: number
): Promise<ClusterTopicDocumentsSelection[]> {
  return getDb()
    .selectFrom('cluster_topic_documents')
    .selectAll()
    .where('topic_id', '=', topicId)
    .orderBy('version', 'desc')
    .execute();
}

export async function getLatestTopicDocument(
  topicId: number
): Promise<ClusterTopicDocumentsSelection | undefined> {
  return getDb()
    .selectFrom('cluster_topic_documents')
    .selectAll()
    .where('topic_id', '=', topicId)
    .orderBy('version', 'desc')
    .executeTakeFirst();
}

export async function getTopicDocumentById(
  id: number
): Promise<ClusterTopicDocumentsSelection | undefined> {
  return getDb()
    .selectFrom('cluster_topic_documents')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
}
