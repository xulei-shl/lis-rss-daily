/**
 * 多维分析缓存仓储（cluster_topic_analysis）。
 *
 * status 三态（设计文档 §7.7）：
 *   ok                 正常生成
 *   insufficient_data  样本不足，只输出规则部分（**不是错误**，前端需区分展示）
 *   failed             LLM 调用或 schema 校验失败；**不得写入占位文本**
 */

import { getDb, type ClusterTopicAnalysisSelection } from '../../db.js';
import type { AnalysisStatus } from '../config.js';

export interface AnalysisRow {
  topicId: number;
  analysisJson: string;
  matrixJson: string | null;
  inputHash: string;
  linkedCount: number;
  contractVersion: string;
  status: AnalysisStatus;
  errorMessage: string | null;
}

export async function upsertTopicAnalysis(row: AnalysisRow): Promise<void> {
  const now = new Date().toISOString();
  await getDb()
    .insertInto('cluster_topic_analysis')
    .values({
      topic_id: row.topicId,
      analysis_json: row.analysisJson,
      matrix_json: row.matrixJson,
      input_hash: row.inputHash,
      linked_count: row.linkedCount,
      contract_version: row.contractVersion,
      status: row.status,
      error_message: row.errorMessage,
      analyzed_at: now,
    })
    .onConflict((oc) =>
      oc.column('topic_id').doUpdateSet({
        analysis_json: row.analysisJson,
        matrix_json: row.matrixJson,
        input_hash: row.inputHash,
        linked_count: row.linkedCount,
        contract_version: row.contractVersion,
        status: row.status,
        error_message: row.errorMessage,
        analyzed_at: now,
      })
    )
    .execute();
}

export async function getTopicAnalysis(
  topicId: number
): Promise<ClusterTopicAnalysisSelection | undefined> {
  return getDb()
    .selectFrom('cluster_topic_analysis')
    .selectAll()
    .where('topic_id', '=', topicId)
    .executeTakeFirst();
}

/** 读取某主题已缓存的 inputHash，用于跳过未变化的重复分析 */
export async function getAnalysisInputHash(topicId: number): Promise<string | null> {
  const row = await getDb()
    .selectFrom('cluster_topic_analysis')
    .select('input_hash')
    .where('topic_id', '=', topicId)
    .executeTakeFirst();
  return row?.input_hash ?? null;
}
