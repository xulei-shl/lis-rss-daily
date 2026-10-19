/**
 * 切面向量化封装。
 *
 * 复用现有 embedding 能力（`getEmbedding` / `getEmbeddingsBatch`，走 /settings 的
 * 「Embedding 配置」），**不新建任何向量服务**（设计文档 §15.6）。
 *
 * 两点必须守住：
 *   1. 向量化对象是**切面文本**（buildFacetText 的产物），不是全文总结原文；
 *   2. 存库前统一**归一化**，让后续聚类只需点积（余弦）——省掉每次重复开方。
 */

import { getActiveConfigByType } from '../api/llm-configs.js';
import { getEmbedding, getEmbeddingsBatch } from '../vector/embedding-client.js';
import { CLUSTER_CONFIG } from './config.js';
import { assertVectorDim, normalize, vectorToBlob } from './domain/vector.js';

export interface FacetEmbedding {
  /** 已归一化 */
  vector: Float32Array;
  /** float32 小端 BLOB（可直接落库） */
  blob: Buffer;
  dim: number;
  model: string | null;
}

/** 单条切面文本 → 向量 */
export async function embedFacetText(text: string, userId: number): Promise<FacetEmbedding> {
  const raw = await getEmbedding(text, userId);
  return toFacetEmbedding(raw, await currentModel(userId));
}

/** 批量切面文本 → 向量（顺序与输入一致） */
export async function embedFacetTexts(
  texts: string[],
  userId: number
): Promise<FacetEmbedding[]> {
  if (texts.length === 0) return [];
  const raw = await getEmbeddingsBatch(texts, userId);
  const model = await currentModel(userId);
  return raw.map((vector) => toFacetEmbedding(vector, model));
}

/**
 * 当前 embedding 模型名（用于落库快照与「换模型需重建」的漂移检测）。
 * 取不到不报错——模型名只用于审计，不影响聚类正确性。
 */
export async function currentModel(userId: number): Promise<string | null> {
  try {
    const config = await getActiveConfigByType(userId, 'embedding');
    return config?.model ?? null;
  } catch {
    return null;
  }
}

function toFacetEmbedding(vector: number[], model: string | null): FacetEmbedding {
  // 维度不符直接抛错：宁可整篇失败，也不让错维向量进入聚类（会静默产生垃圾簇）
  assertVectorDim(vector, CLUSTER_CONFIG.embeddingDim, 'facet embedding');
  const normalized = normalize(vector);
  return {
    vector: normalized,
    blob: vectorToBlob(normalized),
    dim: CLUSTER_CONFIG.embeddingDim,
    model,
  };
}
