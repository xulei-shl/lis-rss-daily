/**
 * 范式域聚合（规则层，零 token；设计文档 v2 §4.2）。
 *
 * 目标：把矩阵里的几十个「方法 × 对象」格聚成 3~5 个可读的范式域，
 * 让 LLM 只写四段叙述，而不是面对一屏格子自行分组。
 *
 * 算法：
 *   1. 每个格用其成员向量质心表示；
 *   2. 以格为节点做平均连接凝聚，目标 3~5 域、合并下限 0.80；
 *   3. 域内按「核心基石 / 创新发散 / 前沿时效」抽样，总数 ≤7。
 */

import type { MatrixResult } from './matrix.js';
import { cohesionClusters } from '../domain/clustering.js';
import { shortHash } from '../domain/hash.js';
import { dotNormalized, normalize } from '../domain/vector.js';
import type { TopicMemberView } from './member-view.js';

export interface ParadigmDomain {
  domainKey: string;
  name: string;
  methods: string[];
  objects: string[];
  articleCount: number;
  /** 进入 Prompt 的域代表（≤7） */
  representativeIds: number[];
  coreArticleIds: number[];
  innovativeArticleIds: number[];
  frontierArticleIds: number[];
}

export interface ParadigmBuildResult {
  domains: ParadigmDomain[];
  /** 无法稳定归域的单篇特异视角，不强行综述 */
  sparseArticleIds: number[];
}

interface CellNode {
  method: string;
  object: string;
  articleIds: number[];
  vector: Float32Array;
}

export function buildParadigmDomains(
  matrix: MatrixResult,
  members: TopicMemberView[]
): ParadigmBuildResult {
  const memberMap = new Map(members.map((member) => [member.articleId, member]));
  const nodes: CellNode[] = [];

  for (const cell of matrix.cells) {
    const cellMembers = cell.articleIds
      .map((id) => memberMap.get(id))
      .filter((member): member is TopicMemberView => Boolean(member));
    if (cellMembers.length === 0) continue;
    nodes.push({
      method: cell.method,
      object: cell.object,
      articleIds: cell.articleIds,
      vector: centroidOf(cellMembers.map((member) => member.vector)),
    });
  }

  if (nodes.length === 0) return { domains: [], sparseArticleIds: [] };

  // 单篇格不单独成域；先只让 C>=2 的格参与聚类。
  const dense = nodes.filter((node) => node.articleIds.length >= 2);
  const sparse = nodes.filter((node) => node.articleIds.length < 2);
  const clusteringNodes = dense.length >= 3 ? dense : nodes;

  const targetCount = Math.min(
    clusteringNodes.length,
    clamp(Math.ceil(clusteringNodes.length / 4), 3, 5)
  );
  const { components } = cohesionClusters(
    clusteringNodes.map((node, index) => ({ id: index, vector: node.vector })),
    0.8,
    { minSize: 1, linkage: 'average', targetCount, cutSimilarityFloor: 0.8 }
  );

  const domains: ParadigmDomain[] = components.map((component) => {
    const cellNodes = component.ids
      .map((index) => clusteringNodes[index])
      .filter((node): node is CellNode => Boolean(node));
    return buildDomain(cellNodes, memberMap);
  });

  // 稀疏格：共享方法/对象且质心足够近才并入；否则留在 sparseArticleIds。
  const sparseArticleIds: number[] = [];
  for (const node of sparse) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < domains.length; i += 1) {
      const domain = domains[i];
      const aligned =
        domain.methods.includes(node.method) || domain.objects.includes(node.object);
      if (!aligned) continue;
      const domainCellCentroid = centroidOf(
        domain.representativeIds
          .map((id) => memberMap.get(id))
          .filter((member): member is TopicMemberView => Boolean(member))
          .map((member) => member.vector)
      );
      const similarity = dotNormalized(node.vector, domainCellCentroid);
      if (similarity >= 0.85 && similarity > bestScore) {
        bestScore = similarity;
        best = i;
      }
    }

    if (best >= 0) {
      const domain = domains[best];
      const merged = new Set([...domain.representativeIds, ...node.articleIds]);
      domain.articleCount += node.articleIds.length;
      domain.representativeIds = [...merged].slice(0, 7);
    } else {
      sparseArticleIds.push(...node.articleIds);
    }
  }

  return {
    domains: domains.sort((a, b) => b.articleCount - a.articleCount || a.domainKey.localeCompare(b.domainKey)),
    sparseArticleIds,
  };
}

function buildDomain(
  cellNodes: CellNode[],
  memberMap: Map<number, TopicMemberView>
): ParadigmDomain {
  const articleIds = unique(cellNodes.flatMap((node) => node.articleIds));
  const pool = articleIds
    .map((id) => memberMap.get(id))
    .filter((member): member is TopicMemberView => Boolean(member));
  const centroid = centroidOf(pool.map((member) => member.vector));

  const methods = topCounts(cellNodes.map((node) => node.method), 3);
  const objects = topCounts(cellNodes.map((node) => node.object), 3);

  const byCentroid = [...pool].sort(
    (a, b) =>
      dotNormalized(b.vector, centroid) - dotNormalized(a.vector, centroid) ||
      a.articleId - b.articleId
  );
  const core = byCentroid.slice(0, 3);

  const selected = new Set(core.map((member) => member.articleId));
  const innovative: TopicMemberView[] = [];
  const remaining = pool.filter((member) => !selected.has(member.articleId));
  while (innovative.length < 2 && remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      const minSimilarity = Math.max(
        ...[...selected].map((id) => {
          const member = memberMap.get(id);
          return member ? dotNormalized(candidate.vector, member.vector) : 0;
        })
      );
      if (-minSimilarity > bestDistance) {
        bestDistance = -minSimilarity;
        bestIndex = i;
      }
    }
    const picked = remaining.splice(bestIndex, 1)[0];
    innovative.push(picked);
    selected.add(picked.articleId);
  }

  const frontier = [...pool]
    .sort((a, b) => {
      if (a.eventDate === b.eventDate) return b.articleId - a.articleId;
      if (!a.eventDate) return 1;
      if (!b.eventDate) return -1;
      return a.eventDate < b.eventDate ? 1 : -1;
    })
    .slice(0, 2)
    .filter((member) => !selected.has(member.articleId) || selected.size < 7);

  const representativeIds = unique([
    ...core.map((member) => member.articleId),
    ...innovative.map((member) => member.articleId),
    ...frontier.map((member) => member.articleId),
  ]).slice(0, 7);

  const name = [methods[0], objects[0]].filter(Boolean).join(' × ') || '综合范式';
  return {
    domainKey: `d-${shortHash(`${methods.join('|')}\u0000${objects.join('|')}`, 8)}`,
    name,
    methods,
    objects,
    articleCount: articleIds.length,
    representativeIds,
    coreArticleIds: core.map((member) => member.articleId),
    innovativeArticleIds: innovative.map((member) => member.articleId),
    frontierArticleIds: frontier.map((member) => member.articleId),
  };
}

function topCounts(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function centroidOf(vectors: Float32Array[]): Float32Array {
  if (vectors.length === 0) return new Float32Array(0);
  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i += 1) sum[i] += vector[i];
  }
  for (let i = 0; i < dim; i += 1) sum[i] /= vectors.length;
  return normalize(sum);
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
