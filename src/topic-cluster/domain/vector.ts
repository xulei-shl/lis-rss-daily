/**
 * 向量基础运算（纯函数，无任何 IO 依赖）。
 *
 * 存储格式：float32 小端 BLOB。SQLite 无向量类型，因此自存 BLOB。
 * 维度由 embedding 模型决定（当前 BAAI/bge-m3 = 1024）。
 *
 * 设计约束：本文件不允许 import 数据库、日志或 LLM，保证可单测。
 */

/** number[] → float32 小端 BLOB（复制一份，不引用外部 buffer） */
export function vectorToBlob(vector: ArrayLike<number>): Buffer {
  const source = Float32Array.from(vector);
  const bytes = new Uint8Array(source.buffer.slice(0));
  return Buffer.from(bytes);
}

/**
 * float32 BLOB → Float32Array。
 *
 * 先复制到独立 ArrayBuffer 再解释，避免 `new Float32Array(buffer, byteOffset, len)`
 * 因 byteOffset 非 4 的倍数而抛 RangeError（SQLite 返回的 Buffer 不保证对齐）。
 */
export function blobToVector(blob: Buffer | Uint8Array): Float32Array {
  const bytes = new Uint8Array(blob.byteLength);
  bytes.set(blob instanceof Uint8Array ? blob : new Uint8Array(blob as ArrayBuffer));
  return new Float32Array(bytes.buffer);
}

/** 维度（元素个数，不是字节数） */
export function vectorDim(blob: Buffer | Uint8Array): number {
  return Math.floor(blob.byteLength / 4);
}

/** 维度校验，不匹配直接抛错（fail fast，避免脏数据进入聚类） */
export function assertVectorDim(
  vector: ArrayLike<number>,
  expectedDim: number,
  context: string
): void {
  if (vector.length !== expectedDim) {
    throw new Error(
      `[topic-cluster] 向量维度不匹配：${context} 期望 ${expectedDim}，实际 ${vector.length}`
    );
  }
}

/** L2 归一化（零向量原样返回，由调用方负责校验） */
export function normalize(vector: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(vector);
  let sum = 0;
  for (let i = 0; i < out.length; i += 1) sum += out[i] * out[i];
  const norm = Math.sqrt(sum);
  if (norm === 0) return out;
  for (let i = 0; i < out.length; i += 1) out[i] /= norm;
  return out;
}

/** 余弦相似度（通用版，会自行计算模长） */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 已归一化向量的余弦（= 点积）。聚类内层循环专用，避免重复算模长 */
export function dotNormalized(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) dot += a[i] * b[i];
  return dot;
}

/** 均值向量（不归一化） */
export function meanVector(vectors: ArrayLike<number>[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0);
  const dim = vectors[0].length;
  const sum = new Float64Array(dim);
  for (const vector of vectors) {
    const len = Math.min(dim, vector.length);
    for (let i = 0; i < len; i += 1) sum[i] += vector[i];
  }
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) out[i] = sum[i] / vectors.length;
  return out;
}

/** 质心 = 均值 + 归一化 */
export function centroidOf(vectors: ArrayLike<number>[]): Float32Array {
  return normalize(meanVector(vectors));
}
