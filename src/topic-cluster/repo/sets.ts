/**
 * 主题集合版本仓储（cluster_topic_sets）。
 *
 * 版本化是「重建主题集合」的基础：日常增量永远在 active 版本上追加；
 * 只有规则/模型变更才产生新版本，旧版本归档保留（保证旧 URL 与旧分析不失效）。
 */

import { getDb, type ClusterTopicSetsSelection } from '../../db.js';
import { CLUSTER_CONFIG } from '../config.js';

export interface CreateSetInput {
  version: number;
  triggerReason: string;
  embeddingModel: string | null;
  embeddingDim: number;
  facetContractVersion: string;
  initThreshold: number;
  note?: string | null;
}

/** 读取当前 active 版本；不存在时返回 undefined */
export async function getActiveSet(userId: number): Promise<ClusterTopicSetsSelection | undefined> {
  void userId; // 版本表当前为全局单租户，保留参数以便未来多租户
  return getDb()
    .selectFrom('cluster_topic_sets')
    .selectAll()
    .where('status', '=', 'active')
    .executeTakeFirst();
}

/** 下一个版本号（无版本时为 1） */
export async function nextSetVersion(): Promise<number> {
  const row = await getDb()
    .selectFrom('cluster_topic_sets')
    .select((eb) => eb.fn.max('version').as('maxVersion'))
    .executeTakeFirst();
  const maxVersion = row?.maxVersion ? Number(row.maxVersion) : 0;
  return maxVersion + 1;
}

/** 创建新版本（调用方需保证旧版本已被归档，partial unique index 会强制唯一 active） */
export async function createSet(input: CreateSetInput): Promise<number> {
  const db = getDb();
  await db
    .insertInto('cluster_topic_sets')
    .values({
      version: input.version,
      status: 'active',
      trigger_reason: input.triggerReason,
      embedding_model: input.embeddingModel,
      embedding_dim: input.embeddingDim,
      facet_contract_version: input.facetContractVersion,
      init_threshold: input.initThreshold,
      note: input.note ?? null,
    })
    .execute();
  return input.version;
}

/** 归档指定版本 */
export async function archiveSet(version: number): Promise<void> {
  await getDb()
    .updateTable('cluster_topic_sets')
    .set({ status: 'archived', archived_at: new Date().toISOString() })
    .where('version', '=', version)
    .execute();
}

/** 版本列表（用于重建审计与旧 URL 判定） */
export async function listSetVersions(): Promise<ClusterTopicSetsSelection[]> {
  return getDb()
    .selectFrom('cluster_topic_sets')
    .selectAll()
    .orderBy('version', 'desc')
    .execute();
}

export interface ConfigDrift {
  drifted: boolean;
  reasons: string[];
}

/**
 * 检测「当前配置」与 active 版本快照是否漂移。
 *
 * 漂移只告警、不自动重建——重建是重操作，必须人工确认（设计文档 §7.9）。
 */
export function detectConfigDrift(active: ClusterTopicSetsSelection): ConfigDrift {
  const reasons: string[] = [];

  if (active.facet_contract_version && active.facet_contract_version !== CLUSTER_CONFIG.facetContractVersion) {
    reasons.push(
      `切面契约版本变化：${active.facet_contract_version} → ${CLUSTER_CONFIG.facetContractVersion}`
    );
  }

  if (active.embedding_dim && active.embedding_dim !== CLUSTER_CONFIG.embeddingDim) {
    reasons.push(`embedding 维度变化：${active.embedding_dim} → ${CLUSTER_CONFIG.embeddingDim}`);
  }

  if (
    typeof active.init_threshold === 'number' &&
    Math.abs(active.init_threshold - CLUSTER_CONFIG.initThreshold) > 0.03
  ) {
    reasons.push(
      `冷启动阈值变化超过 ±0.03：${active.init_threshold} → ${CLUSTER_CONFIG.initThreshold}`
    );
  }

  return { drifted: reasons.length > 0, reasons };
}
