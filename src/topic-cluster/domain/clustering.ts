/**
 * 聚类算法（纯函数，无 IO）。
 *
 * 用途：冷启动全量聚类、游离池孵化。
 *
 * ## 为什么默认用平均连接（UPGMA）而不是单链
 *
 * 单链只要存在**一条**桥接对，就会把两个不相干的簇连成一个：
 * 实测（30 篇、θ=0.65）单链产出 25 篇的簇，而簇内最小两两相似度只有 **0.47** ——
 * 阈值说 0.65，实际放进来 0.47 的文章，这种「主题」的语义不可信，
 * 而且它直接污染下游的角度分群、脉络与多维分析。
 *
 * 平均连接用**两簇成员之间的平均相似度**判合并，实测 θ=0.70 时簇内最小两两 0.69 ≈ θ，
 * 即阈值「说到做到」。两者都无需新依赖（对照：HDBSCAN 需 Python 侧依赖，见设计文档 §7.0）。
 *
 * ## 边界（不要误读）
 *
 * - 平均连接修的是**假合并**，不修**空仓**：阈值高于整个数据集相似度上界时，照样一簇都孵不出。
 *   两个问题独立，前者靠算法，后者靠阈值校准（`pnpm run cluster:validate`）。
 * - 相似度矩阵 O(n²) 内存（817 篇 ≈ 2.7MB），凝聚过程 O(n³) 量级（817 篇数秒内）。
 *   当前规模（数百篇）足够；若未来上到万篇量级需要重新评估。
 */

import { centroidOf, dotNormalized } from './vector.js';

export interface ClusterItem {
  id: number;
  /** 必须已归一化（调用方负责），否则相似度计算会失准 */
  vector: Float32Array;
}

export interface ClusterComponent {
  ids: number[];
  centroid: Float32Array;
}

export interface ClusterResult {
  /** 成簇的分量（按成员数降序），每个分量含归一化质心 */
  components: ClusterComponent[];
  /** 未成簇的文章 id（留在游离池） */
  noiseIds: number[];
}

/**
 * 簇间相似度的连接方式。
 *
 * `average` 是生产默认值。`single` 保留用于两点：校准脚本做 A/B 对比（
 * `cluster:validate` 会同时打印两种连接的结果），以及必要时回退到旧行为。
 */
export type Linkage = 'average' | 'single';

export interface CohesionOptions {
  /** 低于此规模的分量视为噪声 */
  minSize: number;
  /** 默认 'average' */
  linkage?: Linkage;
  /** 相似度矩阵构建进度回调（凝聚阶段不再回调） */
  onProgress?: (done: number, total: number) => void;
}

/**
 * 按相似度阈值成簇。
 *
 * 判据是**簇间连接度**：平均连接取两簇成员间的平均相似度，
 * 单链取两簇间最近的一对（后者会产生桥接链）。
 *
 * @param items 待聚类项（向量需已归一化）
 * @param threshold 簇间相似度阈值
 */
export function cohesionClusters(
  items: ClusterItem[],
  threshold: number,
  options: CohesionOptions
): ClusterResult {
  const n = items.length;
  if (n === 0) return { components: [], noiseIds: [] };

  const sim = buildSimilarityMatrix(items, options.onProgress);
  const groups =
    (options.linkage ?? 'average') === 'single'
      ? mergeBySingleLink(sim, n, threshold)
      : mergeByAverageLink(sim, n, threshold);

  return toResult(groups, items, options.minSize);
}

/* ── 内部实现 ── */

/** 对称相似度矩阵（仅计算上三角后镜像），行主序展开为 Float32Array */
function buildSimilarityMatrix(items: ClusterItem[], onProgress?: CohesionOptions['onProgress']): Float32Array {
  const n = items.length;
  const sim = new Float32Array(n * n);
  const progressEvery = Math.max(1, Math.floor(n / 10));

  for (let i = 0; i < n; i += 1) {
    sim[i * n + i] = 1;
    const vi = items[i].vector;
    for (let j = i + 1; j < n; j += 1) {
      const value = dotNormalized(vi, items[j].vector);
      sim[i * n + j] = value;
      sim[j * n + i] = value;
    }
    if (onProgress && i % progressEvery === 0) onProgress(i, n);
  }

  return sim;
}

/**
 * 平均连接凝聚：每轮合并「平均相似度最高」且 ≥ 阈值的一对簇。
 *
 * 用 Lance–Williams 更新式增量计算簇间平均相似度，避免每轮重扫全部成员对：
 *   s(A∪B, C) = (|A|·s(A,C) + |B|·s(B,C)) / (|A|+|B|)
 *
 * 合并写回槽位 A、停用槽位 B，因此不需要重建矩阵。
 */
function mergeByAverageLink(sim: Float32Array, n: number, threshold: number): number[][] {
  const active = new Uint8Array(n).fill(1);
  const size = new Int32Array(n).fill(1);
  const members: number[][] = Array.from({ length: n }, (_, index) => [index]);
  let activeCount = n;

  while (activeCount > 1) {
    let bestA = -1;
    let bestB = -1;
    let best = Number.NEGATIVE_INFINITY;

    for (let a = 0; a < n; a += 1) {
      if (!active[a]) continue;
      const rowOffset = a * n;
      for (let b = a + 1; b < n; b += 1) {
        if (!active[b]) continue;
        const value = sim[rowOffset + b];
        if (value > best) {
          best = value;
          bestA = a;
          bestB = b;
        }
      }
    }

    // 没有任何一对达到阈值 → 收敛
    if (bestA === -1 || best < threshold) break;

    const sizeA = size[bestA];
    const sizeB = size[bestB];
    const merged = sizeA + sizeB;

    for (let k = 0; k < n; k += 1) {
      if (!active[k] || k === bestA || k === bestB) continue;
      const average = (sizeA * sim[bestA * n + k] + sizeB * sim[bestB * n + k]) / merged;
      sim[bestA * n + k] = average;
      sim[k * n + bestA] = average;
    }

    members[bestA].push(...members[bestB]);
    members[bestB] = [];
    size[bestA] = merged;
    active[bestB] = 0;
    activeCount -= 1;
  }

  return members.filter((_, index) => active[index] === 1);
}

/** 单链（并查集）：相似度 ≥ 阈值即归入同一连通分量。保留用于 A/B 对比与回退 */
function mergeBySingleLink(sim: Float32Array, n: number, threshold: number): number[][] {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i += 1) parent[i] = i;

  const find = (start: number): number => {
    let root = start;
    while (parent[root] !== root) root = parent[root];
    let current = start;
    while (parent[current] !== root) {
      const next = parent[current];
      parent[current] = root;
      current = next;
    }
    return root;
  };

  for (let i = 0; i < n; i += 1) {
    const rowOffset = i * n;
    for (let j = i + 1; j < n; j += 1) {
      if (sim[rowOffset + j] < threshold) continue;
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent[rootJ] = rootI;
    }
  }

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(i);
    else buckets.set(root, [i]);
  }
  return [...buckets.values()];
}

function toResult(groups: number[][], items: ClusterItem[], minSize: number): ClusterResult {
  const components: ClusterComponent[] = [];
  const noiseIds: number[] = [];

  for (const group of groups) {
    // 成员 id 排序，保证同一成员集合产出同一结果（路径/哈希不随内部合并顺序变化）
    const ids = group.map((index) => items[index].id).sort((a, b) => a - b);
    if (group.length < minSize) {
      noiseIds.push(...ids);
      continue;
    }
    components.push({
      ids,
      centroid: centroidOf(group.map((index) => items[index].vector)),
    });
  }

  // 按成员数降序，成员数相同按最小 id，保证输出稳定可复现
  components.sort((a, b) => b.ids.length - a.ids.length || a.ids[0] - b.ids[0]);
  noiseIds.sort((a, b) => a - b);

  return { components, noiseIds };
}
