/**
 * 簇内研究脉络（纯函数，无 IO）——设计文档 §7.5，本模块核心。
 *
 * 术语对齐：
 *   - **角度（angle）**：同一主题下文章分化的不同切入角度；
 *   - **脉络（thread）**：一个角度内按时间排列的承接序列。
 *
 * 重要设计取舍：**一个角度 = 一条脉络**（`topic_threads` 的 UNIQUE(topic_id, angle_key)）。
 * 角度内不再拆多条并行线，以保持 KISS；但只有「整簇都接不上」才降级：
 *   - 存在至少 minThreadLength 篇的连续承接段 → `linear`，段内为 backbone；
 *   - 完全没有这样的连续段 → `divergent`（并列子域），保留全部成员并给出代表作。
 *
 * 不能用「全簇相邻承接率」一票否决：20+ 篇的大角度里，一两段局部脉络常被
 * 跨时期的离群点稀释到阈值以下，导致所有成员都被误标为未形成演进。
 *
 * 诚实边界：系统没有引文数据，「承接」是基于语义 + 方法 + 对象相似度**推断**的，
 * 不是真实学术传承关系，前端必须标注口径。
 */

import { cohesionClusters, type ClusterItem, type ClusterComponent } from './clustering.js';
import { shortHash } from './hash.js';
import { sharesAny, type DatePrecision } from './facet.js';
import { dotNormalized, normalize, centroidOf } from './vector.js';

export interface ChainItem {
  articleId: number;
  /** 需已归一化 */
  vector: Float32Array;
  eventDate: string | null;
  precision: DatePrecision;
  methodKeys: string[];
  objectKeys: string[];
}

export interface SubtopicGroup {
  subtopicKey: string;
  label: string | null;
  members: ChainItem[];
  centroid: Float32Array;
  /** 兼容既有角度接口 */
  angleKey: string;
  angleLabel: string | null;
}

export type AngleGroup = SubtopicGroup;

/** 子主题/脉络身份：用于重建时复用 key 与 label，避免成员小幅变动导致身份漂移 */
export interface SubtopicIdentity {
  subtopicKey?: string;
  label?: string | null;
  angleKey?: string;
  angleLabel?: string | null;
  articleIds: number[];
}

export type AngleIdentity = SubtopicIdentity;

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

export interface SubtopicOptions {
  /** K_target 上限（默认 8） */
  maxSubtopics?: number;
  /** 兼容旧参数 maxAngleCount */
  maxAngleCount?: number;
  /** 旧脉络身份；为空表示首次构建 */
  previous?: SubtopicIdentity[];
}

export type AngleOptions = SubtopicOptions;

export interface ThreadOptions {
  minThreadLength: number;
  strongThreshold: number;
  chainThreshold: number;
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
 * 子主题/分面二次聚类（纯向量平均连接凝聚 + 离散点就近吸收 + 身份平滑继承）。
 *
 * 废除旧 groupAngles 中的黑洞吞并逻辑（mergeUntilLimit），改用受控的纯向量凝聚：
 *   1. 簇内纯向量平均连接凝聚（θ ≈ 0.70，目标 K=2~maxSubtopics）；
 *   2. 离散点/极小簇只对比初始质心就近吸收，杜绝滚雪球吞并；
 *   3. 身份平滑继承（基于历史 Jaccard），保证增量跑批时稳定。
 */
export function groupSubtopics(
  items: ChainItem[],
  subtopicThreshold: number = 0.70,
  options: SubtopicOptions = {}
): SubtopicGroup[] {
  if (items.length === 0) return [];

  const maxCount = options.maxSubtopics ?? options.maxAngleCount ?? 8;
  const targetCount = clamp(Math.ceil(items.length / 8), 2, maxCount);
  const minSize = 2; // 最少 2 篇成簇

  // 1. 簇内纯向量平均连接凝聚
  const { components, noiseIds } = cohesionClusters(
    items.map((m) => ({ id: m.articleId, vector: m.vector })),
    subtopicThreshold,
    { minSize, linkage: 'average', targetCount, cutSimilarityFloor: Math.min(subtopicThreshold, 0.68) }
  );

  // 2. 离散点/极小簇就近吸收（寻找最近质心，绝不滚雪球吞并）
  const subtopics = formBalancedSubtopics(components, noiseIds, items, maxCount, targetCount);

  // 3. 身份平滑继承（基于历史 Jaccard 相似度，防止周度跑批时 Key 与 Label 乱漂）
  assignStableIdentities(subtopics, options.previous ?? []);

  return subtopics.sort(
    (a, b) =>
      b.members.length - a.members.length ||
      minArticleId(a.members) - minArticleId(b.members) ||
      (a.subtopicKey < b.subtopicKey ? -1 : 1)
  );
}

/** 兼容旧 groupAngles 命名与调用签名 */
export function groupAngles(
  items: ChainItem[],
  angleThreshold: number,
  options: AngleOptions
): AngleGroup[] {
  return groupSubtopics(items, angleThreshold, options);
}

/**
 * 角度内时间串链：产出逐步关系判定。
 *
 * 跨时间精度（day / year / ingest）的相邻对不构成承接：前端不画箭头。
 * 在同一子课题内，共享方法或共享对象，或者语义相似度达到 chainThreshold，
 * 均视为学术探索的自然承接；否则为研究转向。
 */
export function buildSteps(
  group: SubtopicGroup,
  options: Pick<ThreadOptions, 'strongThreshold' | 'chainThreshold'>
): ChainStep[] {
  const members = sortByEventDate(group.members);
  const steps: ChainStep[] = [];

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
    const crossPrecision = current.precision !== prev.precision;

    // 承接判定：同一子课题内，共享方法或共享对象，或者语义相似度达到 chainThreshold，
    // 均视为学术探索的自然承接；否则为研究转向。跨精度不画箭头。
    const relation: Relation =
      !crossPrecision &&
      (sharedObject || sharedMethod || similarity >= options.chainThreshold)
        ? 'continue'
        : 'shift';

    steps.push({
      articleId: current.articleId,
      seq: i,
      relation,
      similarityToPrev: similarity,
      sharedMethod,
      sharedObject,
      crossPrecision,
    });
  }

  return steps;
}

/**
 * 由子课题/角度产出脉络。
 *
 * - linear：存在连续承接段（>= minThreadLength），段内标为 backbone，段外为 divergent；
 * - divergent：无连续承接段，仍完整保留全部成员、时序关系与相似度，并标记代表作。
 */
export function buildThreads(
  angles: SubtopicGroup[],
  options: ThreadOptions
): { threads: Thread[]; loose: ChainItem[] } {
  const threads: Thread[] = [];

  for (const angle of angles) {
    const steps = buildSteps(angle, options);
    const runIds = longestContinueRun(steps);
    const isLinear = runIds.size >= options.minThreadLength;
    const similarities = centroidSimilarities(angle);
    const representatives = pickRepresentatives(angle, similarities);
    const roles = assignDivergentRoles(angle, similarities, representatives);

    threads.push({
      angleKey: angle.subtopicKey,
      angleLabel: angle.label,
      patternType: isLinear ? 'linear' : 'divergent',
      steps: steps.map((step) => ({
        ...step,
        academicRole: isLinear
          ? (runIds.has(step.articleId) ? 'backbone' : 'divergent')
          : (roles.get(step.articleId) ?? 'divergent'),
        isRepresentative: isLinear ? false : representatives.has(step.articleId),
        centroidSimilarity: similarities.get(step.articleId),
      })),
      representatives: isLinear ? [] : [...representatives],
    });
  }

  capAcademicRoles(threads);

  return { threads, loose: [] };
}

/**
 * 最长连续承接段（按成员数计）。
 *
 * `relation === 'continue'` 才是真正可画箭头的承接；相似度单独过线、但方法/对象
 * 都转向的对，不应把整簇从 divergent 里救出来。
 */
function longestContinueRun(steps: ChainStep[]): Set<number> {
  if (steps.length === 0) return new Set();

  let bestStart = 0;
  let bestLength = 1;
  let currentStart = 0;
  let currentLength = 1;

  for (let i = 1; i < steps.length; i += 1) {
    if (steps[i].relation === 'continue') {
      currentLength += 1;
    } else {
      currentStart = i;
      currentLength = 1;
    }
    if (currentLength > bestLength) {
      bestStart = currentStart;
      bestLength = currentLength;
    }
  }

  return new Set(
    steps.slice(bestStart, bestStart + bestLength).map((step) => step.articleId)
  );
}

/**
 * 规则侧的可读角度名兜底：高频方法 × 高频对象。
 *
 * 只在 LLM 尚未回填 angle_label 时使用；不落库，避免把占位名当成最终命名。
 */
export function deriveAngleLabel(
  members: Array<Pick<ChainItem, 'methodKeys' | 'objectKeys'>>
): string | null {
  const methods = topKeys(countKeys(members.flatMap((member) => member.methodKeys)), 1);
  const objects = topKeys(countKeys(members.flatMap((member) => member.objectKeys)), 1);
  const method = methods[0];
  const object = objects[0];

  if (!method && !object) return null;
  const label = method && object ? `${method}·${object}` : `${method || object}研究`;
  return label.length > 18 ? label.slice(0, 18) : label;
}

/* ── 角度 / 子主题身份 ── */

/**
 * 优先复用旧脉络/子主题的 key 与 label（成员 Jaccard >= 0.5），避免增量更新导致
 * Changelog、LLM 叙述回填与前端锚点全部漂移；新角度才重新哈希。
 * 同一批次内哈希相同则追加 -2 / -3 后缀，保证 UNIQUE(topic_id, angle_key)。
 */
function assignStableIdentities(
  subtopics: SubtopicGroup[],
  previous: SubtopicIdentity[]
): void {
  const used = new Set<string>();
  const consumed = new Set<string>();
  const ordered = [...subtopics].sort(
    (a, b) =>
      b.members.length - a.members.length ||
      minArticleId(a.members) - minArticleId(b.members)
  );

  for (const subtopic of ordered) {
    const memberIds = new Set(subtopic.members.map((member) => member.articleId));
    let best: SubtopicIdentity | null = null;
    let bestScore = 0;

    for (const identity of previous) {
      const prevKey = identity.subtopicKey || identity.angleKey;
      if (!prevKey || consumed.has(prevKey)) continue;
      const score = jaccard(memberIds, new Set(identity.articleIds));
      if (score > bestScore) {
        bestScore = score;
        best = identity;
      }
    }

    const prevKey = best ? (best.subtopicKey || best.angleKey) : null;
    const prevLabel = best ? (best.label ?? best.angleLabel ?? null) : null;

    if (best && prevKey && bestScore >= 0.5 && !used.has(prevKey)) {
      subtopic.subtopicKey = prevKey;
      subtopic.angleKey = prevKey;
      subtopic.label = prevLabel;
      subtopic.angleLabel = prevLabel;
      consumed.add(prevKey);
    } else {
      const baseKey = buildAngleKey(subtopic.members);
      const uniqueKey = uniqueAngleKey(baseKey, used);
      subtopic.subtopicKey = uniqueKey;
      subtopic.angleKey = uniqueKey;
      subtopic.label = null;
      subtopic.angleLabel = null;
    }
    used.add(subtopic.subtopicKey);
  }
}

const assignAngleKeys = assignStableIdentities;

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

/**
 * 形成平衡子主题：
 * 1. 纯向量平均连接产生的组件作为初始干净子主题；
 * 2. 离散点/极小簇只对比 initialCentroid 就近吸收，彻底避免滚雪球黑洞；
 * 3. 吸收完成后统一定稿质心；
 * 4. 若簇数仍超过 maxSubtopics，受控合并最相近的两簇。
 */
function formBalancedSubtopics(
  components: ClusterComponent[],
  noiseIds: number[],
  items: ChainItem[],
  maxSubtopics: number,
  targetCount: number
): SubtopicGroup[] {
  const byId = new Map(items.map((item) => [item.articleId, item]));

  let activeComponents = components;
  if (activeComponents.length === 0) {
    activeComponents = fallbackComponents(items, targetCount);
    return activeComponents.map((component) => {
      const members = component.ids
        .map((id) => byId.get(id))
        .filter((item): item is ChainItem => Boolean(item));
      const key = buildAngleKey(members);
      return {
        subtopicKey: key,
        label: null,
        angleKey: key,
        angleLabel: null,
        members: sortByEventDate(members),
        centroid: component.centroid,
      };
    });
  }

  const buckets: Array<{
    centroid: Float32Array;
    initialCentroid: Float32Array;
    members: ChainItem[];
  }> = activeComponents.map((component) => {
    const members = component.ids
      .map((id) => byId.get(id))
      .filter((item): item is ChainItem => Boolean(item));
    return {
      centroid: component.centroid,
      initialCentroid: new Float32Array(component.centroid),
      members,
    };
  });

  // 离散点根据初始质心就近吸收，绝不破坏初始簇独立性
  for (const noiseId of noiseIds) {
    const item = byId.get(noiseId);
    if (!item) continue;

    let bestIdx = 0;
    let bestSim = dotNormalized(item.vector, buckets[0].initialCentroid);
    for (let i = 1; i < buckets.length; i += 1) {
      const sim = dotNormalized(item.vector, buckets[i].initialCentroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    buckets[bestIdx].members.push(item);
  }

  // 吸收完成后，整体重新计算质心
  for (const bucket of buckets) {
    bucket.centroid = centroidOfItems(bucket.members);
  }

  // 若簇数仍大于上限（maxSubtopics），受控合并最相近的两簇
  while (buckets.length > maxSubtopics) {
    let bestA = 0;
    let bestB = 1;
    let bestSim = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < buckets.length; i += 1) {
      for (let j = i + 1; j < buckets.length; j += 1) {
        const sim = dotNormalized(buckets[i].centroid, buckets[j].centroid);
        if (sim > bestSim) {
          bestSim = sim;
          bestA = i;
          bestB = j;
        }
      }
    }
    buckets[bestA].members.push(...buckets[bestB].members);
    buckets[bestA].centroid = centroidOfItems(buckets[bestA].members);
    buckets.splice(bestB, 1);
  }

  return buckets.map((bucket) => {
    const key = buildAngleKey(bucket.members);
    return {
      subtopicKey: key,
      label: null,
      angleKey: key,
      angleLabel: null,
      members: sortByEventDate(bucket.members),
      centroid: bucket.centroid,
    };
  });
}

function fallbackComponents(items: ChainItem[], targetCount: number): ClusterComponent[] {
  if (items.length <= 1) {
    return [{ ids: items.map((it) => it.articleId), centroid: items[0]?.vector ?? new Float32Array(0) }];
  }
  const count = clamp(targetCount, 2, items.length);
  const seeds: number[] = [0];
  while (seeds.length < count) {
    let farthestIdx = -1;
    let minMaxSim = Number.POSITIVE_INFINITY;
    for (let i = 0; i < items.length; i += 1) {
      if (seeds.includes(i)) continue;
      let maxSimToSeeds = Number.NEGATIVE_INFINITY;
      for (const s of seeds) {
        const sim = dotNormalized(items[i].vector, items[s].vector);
        if (sim > maxSimToSeeds) maxSimToSeeds = sim;
      }
      if (maxSimToSeeds < minMaxSim) {
        minMaxSim = maxSimToSeeds;
        farthestIdx = i;
      }
    }
    if (farthestIdx >= 0) seeds.push(farthestIdx);
    else break;
  }
  const buckets: Array<{ ids: number[]; vectors: Float32Array[] }> = seeds.map((s) => ({
    ids: [items[s].articleId],
    vectors: [items[s].vector],
  }));
  for (let i = 0; i < items.length; i += 1) {
    if (seeds.includes(i)) continue;
    let bestSeed = 0;
    let bestSim = dotNormalized(items[i].vector, items[seeds[0]].vector);
    for (let s = 1; s < seeds.length; s += 1) {
      const sim = dotNormalized(items[i].vector, items[seeds[s]].vector);
      if (sim > bestSim) {
        bestSim = sim;
        bestSeed = s;
      }
    }
    buckets[bestSeed].ids.push(items[i].articleId);
    buckets[bestSeed].vectors.push(items[i].vector);
  }
  return buckets.map((b) => ({
    ids: b.ids,
    centroid: centroidOf(b.vectors),
  }));
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
