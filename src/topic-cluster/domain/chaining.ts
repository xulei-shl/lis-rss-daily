/**
 * 簇内研究脉络（纯函数，无 IO）——设计文档 §7.5，本模块核心。
 *
 * 术语对齐：
 *   - **角度（angle）**：同一主题下文章分化的不同切入角度；
 *   - **脉络（thread）**：一个角度内按时间排列的承接序列。
 *
 * 重要设计取舍：**一个角度 = 一条脉络**（`topic_threads` 的 UNIQUE(topic_id, angle_key)）。
 * 角度内不再拆多条并行线，以保持 KISS；但「相邻承接率低」不再抹杀整个角度：
 *   - 高承接 → `linear`（时序演进链）；
 *   - 低承接 → `divergent`（发散子议题），保留全部成员并给出代表作。
 *
 * 诚实边界：系统没有引文数据，「承接」是基于语义 + 方法 + 对象相似度**推断**的，
 * 不是真实学术传承关系，前端必须标注口径。
 */

import { cohesionClusters, type ClusterItem } from './clustering.js';
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
  angleLabel: string | null;
  members: ChainItem[];
  centroid: Float32Array;
}

/** 旧脉络身份：用于重建时复用 angle_key，避免成员小幅变动导致身份漂移 */
export interface AngleIdentity {
  angleKey: string;
  angleLabel: string | null;
  articleIds: number[];
}

export type Relation = 'origin' | 'continue' | 'shift';
export type PatternType = 'linear' | 'divergent';
export type AcademicRole = 'backbone' | 'divergent' | 'satellite' | 'frontier';

export interface ChainStep {
  articleId: number;
  seq: number;
  /** divergent 角度不构造承接关系，固定为 null */
  relation: Relation | null;
  similarityToPrev: number | null;
  sharedMethod: boolean;
  sharedObject: boolean;
  /** 与上一篇时间精度不同 → 前端不画承接箭头 */
  crossPrecision: boolean;
  academicRole?: AcademicRole;
  isRepresentative?: boolean;
  /** 与角度质心的相似度，用于角色判定与「为什么是卫星」解释 */
  centroidSimilarity?: number;
}

export interface Thread {
  angleKey: string;
  angleLabel: string | null;
  patternType: PatternType;
  steps: ChainStep[];
  /** divergent 角度的代表作 articleId（3 篇近质心 + 最新 1 篇） */
  representatives: number[];
}

export interface AngleOptions {
  /** K_target 上限（默认 10） */
  maxAngleCount: number;
  /** 旧脉络身份；为空表示首次构建 */
  previous?: AngleIdentity[];
}

export interface ThreadOptions {
  minThreadLength: number;
  strongThreshold: number;
  chainThreshold: number;
  /** 相邻承接率下限，低于此该角度标记为发散子域（不再丢弃） */
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
 * 角度分群：平均连接凝聚 + 目标簇数护栏 + 小角度归并。
 *
 * 与旧实现的区别：旧实现先用贪心 leader 分出很多桶，再硬压到 maxAngleCount；
 * 这里先用平均连接保证「同簇内平均相似度达标」，再用目标簇数防止碎成不可读的
 * 20+ 子域。目标簇数只是停止条件之一，不是唯一判据。
 */
export function groupAngles(
  items: ChainItem[],
  angleThreshold: number,
  options: AngleOptions
): AngleGroup[] {
  if (items.length === 0) return [];

  const targetCount = clamp(
    Math.ceil(items.length / 18),
    3,
    Math.max(3, Math.min(options.maxAngleCount, 10))
  );
  // 文档 §2.2：下限 2、上限 4，避免「3 簇 × 每簇至少 4 篇」在小主题上无解。
  const minAngleSize = clamp(Math.floor(items.length / targetCount), 2, 4);
  // 为凑 K 强行合并异质簇比多留一个角度更糟；低于主题入门阈值即停止。
  const cutSimilarityFloor = Math.max(angleThreshold, 0.78);

  const byId = new Map(items.map((item) => [item.articleId, item]));
  const clusterItems: ClusterItem[] = items.map((item) => ({
    id: item.articleId,
    vector: item.vector,
  }));

  // minSize=1：先拿到完整划分（含单点），再由 mergeSmallBuckets 决定小簇归属。
  const { components } = cohesionClusters(clusterItems, angleThreshold, {
    minSize: 1,
    linkage: 'average',
    targetCount,
    cutSimilarityFloor,
  });

  const buckets: Array<{ centroid: Float32Array; members: ChainItem[] }> = components.map(
    (component) => ({
      centroid: component.centroid,
      members: component.ids
        .map((id) => byId.get(id))
        .filter((item): item is ChainItem => Boolean(item)),
    })
  );

  // 护栏：平均连接可能因阈值提前停止，仍超过目标簇数时合并最相近的簇。
  mergeUntilLimit(buckets, targetCount);
  if (buckets.length > 1) {
    mergeSmallBuckets(buckets, minAngleSize);
  }

  const angles: AngleGroup[] = buckets.map((bucket) => ({
    angleKey: buildAngleKey(bucket.members),
    angleLabel: null,
    members: sortByEventDate(bucket.members),
    centroid: centroidOfItems(bucket.members),
  }));

  assignAngleKeys(angles, options.previous ?? []);

  return angles.sort(
    (a, b) =>
      b.members.length - a.members.length ||
      minArticleId(a.members) - minArticleId(b.members) ||
      (a.angleKey < b.angleKey ? -1 : 1)
  );
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
  const steps: ChainStep[] = [];
  let continuedPairs = 0;

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

/**
 * 由角度产出脉络。
 *
 * - linear：保留时间链，全部为 backbone；
 * - divergent：保留全部成员，按质心相似度分配 divergent / satellite / frontier，
 *   并给出 3 篇近质心 + 最新 1 篇代表作。
 *
 * `loose` 仅为兼容旧调用保留，正常情况下恒为空：没有成员会再被整块丢弃。
 */
export function buildThreads(
  angles: AngleGroup[],
  options: ThreadOptions
): { threads: Thread[]; loose: ChainItem[] } {
  const threads: Thread[] = [];

  for (const angle of angles) {
    const { steps, continuity } = buildSteps(angle, options);
    const isLinear =
      steps.length >= options.minThreadLength &&
      continuity >= options.minContinuityRatio;

    if (isLinear) {
      threads.push({
        angleKey: angle.angleKey,
        angleLabel: angle.angleLabel,
        patternType: 'linear',
        steps: steps.map((step) => ({
          ...step,
          academicRole: 'backbone',
          isRepresentative: false,
        })),
        representatives: [],
      });
      continue;
    }

    const similarities = centroidSimilarities(angle);
    const representatives = pickRepresentatives(angle, similarities);
    const roles = assignDivergentRoles(angle, similarities, representatives);
    const members = sortByEventDate(angle.members);

    threads.push({
      angleKey: angle.angleKey,
      angleLabel: angle.angleLabel,
      patternType: 'divergent',
      steps: members.map((member, index) => ({
        articleId: member.articleId,
        seq: index,
        relation: null,
        similarityToPrev: null,
        sharedMethod: false,
        sharedObject: false,
        crossPrecision: false,
        academicRole: roles.get(member.articleId) ?? 'divergent',
        isRepresentative: representatives.has(member.articleId),
        centroidSimilarity: similarities.get(member.articleId),
      })),
      representatives: [...representatives],
    });
  }

  capAcademicRoles(threads);

  return { threads, loose: [] };
}

/* ── 角度身份 ── */

/**
 * 优先复用旧脉络的 angle_key（成员 Jaccard >= 0.5），避免增量更新导致
 * Changelog、LLM 叙述回填与前端锚点全部漂移；新角度才重新哈希。
 * 同一批次内哈希相同则追加 -2 / -3 后缀，保证 UNIQUE(topic_id, angle_key)。
 */
function assignAngleKeys(angles: AngleGroup[], previous: AngleIdentity[]): void {
  const used = new Set<string>();
  const consumed = new Set<string>();
  const ordered = [...angles].sort(
    (a, b) =>
      b.members.length - a.members.length ||
      minArticleId(a.members) - minArticleId(b.members)
  );

  for (const angle of ordered) {
    const memberIds = new Set(angle.members.map((member) => member.articleId));
    let best: AngleIdentity | null = null;
    let bestScore = 0;

    for (const identity of previous) {
      if (consumed.has(identity.angleKey)) continue;
      const score = jaccard(memberIds, new Set(identity.articleIds));
      if (score > bestScore) {
        bestScore = score;
        best = identity;
      }
    }

    if (best && bestScore >= 0.5 && !used.has(best.angleKey)) {
      angle.angleKey = best.angleKey;
      angle.angleLabel = best.angleLabel;
      consumed.add(best.angleKey);
    } else {
      angle.angleKey = uniqueAngleKey(buildAngleKey(angle.members), used);
      angle.angleLabel = null;
    }
    used.add(angle.angleKey);
  }
}

function uniqueAngleKey(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const id of a) {
    if (b.has(id)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

/* ── 角色判定 ── */

function centroidSimilarities(angle: AngleGroup): Map<number, number> {
  return new Map(
    angle.members.map((member) => [
      member.articleId,
      dotNormalized(member.vector, angle.centroid),
    ])
  );
}

/** 3 篇近质心 + 最新 1 篇；成员不足 4 篇时全部作为代表作 */
function pickRepresentatives(
  angle: AngleGroup,
  similarities: Map<number, number>
): Set<number> {
  const members = sortByEventDate(angle.members);
  if (members.length <= 4) {
    return new Set(members.map((member) => member.articleId));
  }

  const byCentroid = [...members]
    .sort(
      (a, b) =>
        (similarities.get(b.articleId) ?? 0) - (similarities.get(a.articleId) ?? 0) ||
        a.articleId - b.articleId
    )
    .slice(0, 3)
    .map((member) => member.articleId);

  const latest = [...members]
    .sort((a, b) => {
      if (a.eventDate === b.eventDate) return b.articleId - a.articleId;
      if (!a.eventDate) return 1;
      if (!b.eventDate) return -1;
      return a.eventDate < b.eventDate ? 1 : -1;
    })[0];

  const picked = new Set(byCentroid);
  if (latest) picked.add(latest.articleId);
  return picked;
}

function assignDivergentRoles(
  angle: AngleGroup,
  similarities: Map<number, number>,
  representatives: Set<number>
): Map<number, AcademicRole> {
  const roles = new Map<number, AcademicRole>();
  const values = [...similarities.values()].sort((a, b) => a - b);
  const p20 = percentile(values, 0.2);
  const p30 = percentile(values, 0.3);
  const satelliteFloor = Math.max(0.68, p30);

  const methodCounts = countKeys(angle.members.flatMap((member) => member.methodKeys));
  const objectCounts = countKeys(angle.members.flatMap((member) => member.objectKeys));
  const topMethods = new Set(topKeys(methodCounts, 5));
  const topObjects = new Set(topKeys(objectCounts, 5));

  for (const member of angle.members) {
    const similarity = similarities.get(member.articleId) ?? 0;

    if (representatives.has(member.articleId)) {
      roles.set(member.articleId, 'divergent');
      continue;
    }

    const aligned =
      sharesAny(member.methodKeys, [...topMethods]) ||
      sharesAny(member.objectKeys, [...topObjects]);
    if (similarity >= satelliteFloor && aligned) {
      roles.set(member.articleId, 'satellite');
      continue;
    }

    const novel =
      member.methodKeys.some((key) => (methodCounts.get(key) ?? 0) <= 2) ||
      member.objectKeys.some((key) => (objectCounts.get(key) ?? 0) <= 2);
    if (similarity < p20 && novel) {
      roles.set(member.articleId, 'frontier');
      continue;
    }

    roles.set(member.articleId, 'divergent');
  }

  return roles;
}

/**
 * 全局护栏：卫星不超过主题成员的 30%，前沿探针最多 12 篇。
 * 超出的低相似度成员回退为 divergent，绝不丢弃。
 */
function capAcademicRoles(threads: Thread[]): void {
  const allSteps = threads
    .filter((thread) => thread.patternType === 'divergent')
    .flatMap((thread) => thread.steps);
  const totalMembers = threads.reduce((sum, thread) => sum + thread.steps.length, 0);

  demoteRole(allSteps, 'satellite', Math.floor(totalMembers * 0.3));
  demoteRole(allSteps, 'frontier', 12);
}

function demoteRole(steps: ChainStep[], role: AcademicRole, limit: number): void {
  const candidates = steps
    .filter((step) => step.academicRole === role)
    .sort(
      (a, b) =>
        (a.centroidSimilarity ?? 0) - (b.centroidSimilarity ?? 0) ||
        a.articleId - b.articleId
    );

  for (const step of candidates.slice(Math.max(limit, 0))) {
    step.academicRole = 'divergent';
  }
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio));
  return sorted[index];
}

/* ── 内部工具 ── */

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

/** 成员数不足 minAngleSize 的角度并入最相近（优先共享方法/对象）的角度 */
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
      const aligned = bucketSharesAny(buckets[i], buckets[j]);
      // 共享方法/对象的角度优先；没有时退回最近质心，避免把小簇留在外面。
      const score = similarity + (aligned ? 1 : 0);
      if (score > bestSimilarity) {
        bestSimilarity = score;
        target = j;
      }
    }
    if (target < 0) continue;

    const [small, big] = i < target ? [i, target] : [target, i];
    mergeBuckets(buckets, small, big);
  }
}

function bucketSharesAny(
  a: { members: ChainItem[] },
  b: { members: ChainItem[] }
): boolean {
  const aMethods = new Set(a.members.flatMap((member) => member.methodKeys));
  const aObjects = new Set(a.members.flatMap((member) => member.objectKeys));
  return b.members.some(
    (member) =>
      member.methodKeys.some((key) => aMethods.has(key)) ||
      member.objectKeys.some((key) => aObjects.has(key))
  );
}

function mergeBuckets(
  buckets: Array<{ centroid: Float32Array; members: ChainItem[] }>,
  a: number,
  b: number
): void {
  const target = buckets[a];
  const source = buckets[b];
  target.members.push(...source.members);
  target.centroid = centroidOfItems(target.members);
  buckets.splice(b, 1);
}

function centroidOfItems(items: ChainItem[]): Float32Array {
  if (items.length === 0) return new Float32Array(0);
  const dim = items[0].vector.length;
  const sum = new Float32Array(dim);
  for (const item of items) {
    for (let i = 0; i < dim; i += 1) sum[i] += item.vector[i];
  }
  for (let i = 0; i < dim; i += 1) sum[i] /= items.length;
  return normalize(sum);
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
  return signature
    ? `a-${shortHash(signature, 8)}`
    : `a-${shortHash(String(members[0]?.articleId ?? 0), 8)}`;
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

function minArticleId(members: ChainItem[]): number {
  return members.reduce(
    (min, member) => Math.min(min, member.articleId),
    Number.POSITIVE_INFINITY
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
