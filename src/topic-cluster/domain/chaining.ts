/**
 * 簇内研究脉络（纯函数，无 IO）——设计文档 §7.5，本模块核心。
 *
 * 术语对齐：
 *   - **角度（angle）**：同一主题下文章分化的不同切入角度；
 *   - **脉络（thread）**：一个角度内按时间排列的承接序列。
 *
 * 重要设计取舍：**一个角度 = 一条脉络**（`topic_threads` 的 UNIQUE(topic_id, angle_key)）。
 * 角度内不再拆多条并行线，以保持 KISS；若某角度的相邻承接率过低
 * （说明这些文章只是语义相近、并不构成演进），则整体降级为「零散研究」。
 *
 * 诚实边界：系统没有引文数据，「承接」是基于语义 + 方法 + 对象相似度**推断**的，
 * 不是真实学术传承关系，前端必须标注口径。
 */

import { shortHash } from './hash.js';
import { sharesAny, type DatePrecision } from './facet.js';
import { dotNormalized, normalize } from './vector.js';

export interface ChainItem {
  articleId: number;
  /** 需已归一化 */
  vector: Float32Array;
  eventDate: string | null;
  precision: DatePrecision;
  methodKeys: string[];
  objectKeys: string[];
}

export interface AngleGroup {
  angleKey: string;
  members: ChainItem[];
  centroid: Float32Array;
}

export type Relation = 'origin' | 'continue' | 'shift';

export interface ChainStep {
  articleId: number;
  seq: number;
  relation: Relation;
  similarityToPrev: number | null;
  sharedMethod: boolean;
  sharedObject: boolean;
  /** 与上一篇时间精度不同 → 前端不画承接箭头 */
  crossPrecision: boolean;
}

export interface Thread {
  angleKey: string;
  steps: ChainStep[];
}

export interface AngleOptions {
  maxAngleCount: number;
  minAngleSize: number;
}

export interface ThreadOptions {
  minThreadLength: number;
  strongThreshold: number;
  chainThreshold: number;
  /** 相邻承接率下限，低于此该角度降级为零散研究 */
  minContinuityRatio: number;
}

/** 按事件时间升序（空时间排最后），再按 articleId 保证确定性 */
export function sortByEventDate(items: ChainItem[]): ChainItem[] {
  return [...items].sort((a, b) => {
    if (a.eventDate === b.eventDate) return a.articleId - b.articleId;
    if (!a.eventDate) return 1;
    if (!b.eventDate) return -1;
    return a.eventDate < b.eventDate ? -1 : 1;
  });
}

/**
 * 角度分群：贪心 leader 聚类 + 角度数上限合并 + 小角度归并。
 */
export function groupAngles(
  items: ChainItem[],
  angleThreshold: number,
  options: AngleOptions
): AngleGroup[] {
  if (items.length === 0) return [];

  const sorted = sortByEventDate(items);
  const buckets: Array<{ centroid: Float32Array; members: ChainItem[] }> = [];

  for (const item of sorted) {
    let bestIndex = -1;
    let bestSimilarity = -1;
    for (let i = 0; i < buckets.length; i += 1) {
      const similarity = dotNormalized(item.vector, buckets[i].centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0 && bestSimilarity >= angleThreshold) {
      const bucket = buckets[bestIndex];
      bucket.centroid = runningCentroid(bucket.centroid, bucket.members.length, item.vector);
      bucket.members.push(item);
    } else {
      buckets.push({ centroid: normalize(item.vector), members: [item] });
    }
  }

  mergeUntilLimit(buckets, options.maxAngleCount);

  if (buckets.length > 1) {
    mergeSmallBuckets(buckets, options.minAngleSize);
  }

  return buckets
    .map((bucket) => {
      const members = sortByEventDate(bucket.members);
      return {
        angleKey: buildAngleKey(members),
        members,
        centroid: bucket.centroid,
      };
    })
    .sort((a, b) => b.members.length - a.members.length || (a.angleKey < b.angleKey ? -1 : 1));
}

/**
 * 角度内时间串链：产出逐步关系判定。
 *
 * @returns steps 与相邻承接率（相似度 >= chainThreshold 的相邻对占比）
 */
export function buildSteps(
  group: AngleGroup,
  options: Pick<ThreadOptions, 'strongThreshold' | 'chainThreshold'>
): { steps: ChainStep[]; continuity: number } {
  const members = sortByEventDate(group.members);
  const steps: ChainStep[] = [];  let continuedPairs = 0;

  for (let i = 0; i < members.length; i += 1) {
    const current = members[i];
    if (i === 0) {
      steps.push({
        articleId: current.articleId,
        seq: 0,
        relation: 'origin',
        similarityToPrev: null,
        sharedMethod: false,
        sharedObject: false,
        crossPrecision: false,
      });
      continue;
    }

    const prev = members[i - 1];
    const similarity = dotNormalized(current.vector, prev.vector);
    const sharedMethod = sharesAny(current.methodKeys, prev.methodKeys);
    const sharedObject = sharesAny(current.objectKeys, prev.objectKeys);
    if (similarity >= options.chainThreshold) continuedPairs += 1;

    // 承接判定：对象与方法都延续 → 明确承接；否则极相似也算延续；其余视为转向
    const relation: Relation =
      (sharedObject && sharedMethod) || similarity >= options.strongThreshold
        ? 'continue'
        : 'shift';

    steps.push({
      articleId: current.articleId,
      seq: i,
      relation,
      similarityToPrev: similarity,
      sharedMethod,
      sharedObject,
      crossPrecision: current.precision !== prev.precision,
    });
  }

  const pairs = Math.max(members.length - 1, 1);
  return { steps, continuity: continuedPairs / pairs };
}

/** 由角度产出正式脉络，其余归入「零散研究」 */
export function buildThreads(
  angles: AngleGroup[],
  options: ThreadOptions
): { threads: Thread[]; loose: ChainItem[] } {
  const threads: Thread[] = [];
  const loose: ChainItem[] = [];

  for (const angle of angles) {
    const { steps, continuity } = buildSteps(angle, options);
    const isThread =
      steps.length >= options.minThreadLength &&
      continuity >= options.minContinuityRatio;

    if (isThread) {
      threads.push({ angleKey: angle.angleKey, steps });
    } else {
      loose.push(...angle.members);
    }
  }

  return { threads, loose };
}

/* ── 内部工具 ── */

/** 增量更新归一化质心：new = normalize((n * centroid + vector) / (n + 1)) */
function runningCentroid(
  centroid: Float32Array,
  count: number,
  vector: Float32Array
): Float32Array {
  const dim = centroid.length;
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) {
    out[i] = (centroid[i] * count + vector[i]) / (count + 1);
  }
  return normalize(out);
}

/** 角度数超上限时，反复合并质心最相近的两个角度 */
function mergeUntilLimit(
  buckets: Array<{ centroid: Float32Array; members: ChainItem[] }>,
  maxAngleCount: number
): void {
  while (buckets.length > maxAngleCount) {
    let bestA = 0;
    let bestB = 1;
    let bestSimilarity = -Infinity;

    for (let i = 0; i < buckets.length; i += 1) {
      for (let j = i + 1; j < buckets.length; j += 1) {
        const similarity = dotNormalized(buckets[i].centroid, buckets[j].centroid);
        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestA = i;
          bestB = j;
        }
      }
    }

    mergeBuckets(buckets, bestA, bestB);
  }
}

/** 成员数不足 minAngleSize 的角度并入最相近的角度 */
function mergeSmallBuckets(
  buckets: Array<{ centroid: Float32Array; members: ChainItem[] }>,
  minAngleSize: number
): void {
  for (let i = buckets.length - 1; i >= 0; i -= 1) {
    if (buckets[i].members.length >= minAngleSize || buckets.length <= 1) continue;

    let target = -1;
    let bestSimilarity = -Infinity;
    for (let j = 0; j < buckets.length; j += 1) {
      if (j === i) continue;
      const similarity = dotNormalized(buckets[i].centroid, buckets[j].centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        target = j;
      }
    }
    if (target < 0) continue;

    const [small, big] = i < target ? [i, target] : [target, i];
    mergeBuckets(buckets, small, big);
  }
}

function mergeBuckets(
  buckets: Array<{ centroid: Float32Array; members: ChainItem[] }>,
  a: number,
  b: number
): void {
  const target = buckets[a];
  const source = buckets[b];
  target.members.push(...source.members);
  const total = target.members.length;
  const dim = target.centroid.length;
  const merged = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) merged[i] = target.centroid[i];
  const targetCount = total - source.members.length;
  for (let i = 0; i < dim; i += 1) {
    merged[i] = (merged[i] * targetCount + source.centroid[i] * source.members.length) / total;
  }
  target.centroid = normalize(merged);
  buckets.splice(b, 1);
}

/**
 * 角度稳定键：由成员高频方法/对象词生成，与 LLM 命名解耦。
 * 这样 LLM 改名不会导致脉络身份漂移。
 */
function buildAngleKey(members: ChainItem[]): string {
  const methodCounts = countKeys(members.flatMap((member) => member.methodKeys));
  const objectCounts = countKeys(members.flatMap((member) => member.objectKeys));
  const signature = [
    ...topKeys(methodCounts, 3).map((key) => `m:${key}`),
    ...topKeys(objectCounts, 3).map((key) => `o:${key}`),
  ].join('|');
  return signature ? `a-${shortHash(signature, 8)}` : `a-${shortHash(String(members[0].articleId), 8)}`;
}

function countKeys(keys: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function topKeys(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map((entry) => entry[0]);
}
