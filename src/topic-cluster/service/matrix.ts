/**
 * 规则聚合：方法 × 研究对象覆盖矩阵与空缺格（**零 token**）。
 *
 * 这是本模块「让研究空白可验证」的关键输入（设计文档 §7.8）：
 * 如果不先算出结构化的**空格**，让 LLM 直接"读文章归纳空白"，
 * 输出必然退化成「该领域研究不足」这类无法证伪的套话。
 *
 * 因此这里把空白定义为三类**可计算**的证据：
 *   1. matrix_hole     方法×对象交叉矩阵中的空格
 *   2. adjacent_topic  与邻近主题之间从不动用的方法/对象组合
 *   3. staleness       长期无新增（时效缺口），由 metrics 侧提供
 */

export interface MatrixCell {
  method: string;
  object: string;
  count: number;
  articleIds: number[];
}

export interface MatrixHole {
  method: string;
  object: string;
  /** 该行（方法）的文章数 */
  methodCount: number;
  /** 该列（对象）的文章数 */
  objectCount: number;
  /** 出现密度 = min(methodCount, objectCount)，用于排序「最值得关注的空位」 */
  weight: number;
}

export interface MatrixResult {
  methods: string[];
  objects: string[];
  cells: MatrixCell[];
  holes: MatrixHole[];
}

export interface MatrixMemberInput {
  articleId: number;
  methodKeys: string[];
  objectKeys: string[];
}

/** 只保留出现次数达到 minCount 的方法/对象，避免一次性长尾词污染矩阵 */
export function buildMatrix(
  members: MatrixMemberInput[],
  options: { minCount: number; maxHoles: number }
): MatrixResult {
  const methodCounts = countOccurrences(members, (member) => member.methodKeys);
  const objectCounts = countOccurrences(members, (member) => member.objectKeys);

  const methods = pickFrequent(methodCounts, options.minCount);
  const objects = pickFrequent(objectCounts, options.minCount);

  const methodSet = new Set(methods);
  const objectSet = new Set(objects);

  // 先建立「文章 → 命中的方法/对象」映射，再做交叉计数
  const cells = new Map<string, MatrixCell>();
  for (const member of members) {
    const hitMethods = unique(member.methodKeys.filter((key) => methodSet.has(key)));
    const hitObjects = unique(member.objectKeys.filter((key) => objectSet.has(key)));
    for (const method of hitMethods) {
      for (const object of hitObjects) {
        const key = `${method}\u0000${object}`;
        const cell = cells.get(key);
        if (cell) {
          cell.count += 1;
          cell.articleIds.push(member.articleId);
        } else {
          cells.set(key, { method, object, count: 1, articleIds: [member.articleId] });
        }
      }
    }
  }

  const holes: MatrixHole[] = [];
  for (const method of methods) {
    for (const object of objects) {
      if (cells.has(`${method}\u0000${object}`)) continue;
      holes.push({
        method,
        object,
        methodCount: methodCounts.get(method) ?? 0,
        objectCount: objectCounts.get(object) ?? 0,
        weight: Math.min(methodCounts.get(method) ?? 0, objectCounts.get(object) ?? 0),
      });
    }
  }
  // 行、列都较常见却从未交叉 → 最可能是真实空白（而非长尾噪声）
  holes.sort((a, b) => b.weight - a.weight || a.method.localeCompare(b.method));

  return {
    methods,
    objects,
    cells: [...cells.values()].sort((a, b) => b.count - a.count),
    holes: holes.slice(0, options.maxHoles),
  };
}

/**
 * 生成给 LLM 的矩阵摘要文本。
 * 只喂「已有格 + 高分空缺格」，控制输入体量。
 */
export function renderMatrixSummary(matrix: MatrixResult, maxCells = 25): string {
  const lines: string[] = [];

  lines.push(`【方法分布】${matrix.methods.length > 0 ? matrix.methods.join('、') : '样本不足'}`);
  lines.push(`【对象分布】${matrix.objects.length > 0 ? matrix.objects.join('、') : '样本不足'}`);
  lines.push('');
  lines.push('【已有交叉（方法 × 对象 → 篇数）】');
  if (matrix.cells.length === 0) {
    lines.push('（无可交叉统计的组合，样本不足）');
  } else {
    for (const cell of matrix.cells.slice(0, maxCells)) {
      lines.push(`- ${cell.method} × ${cell.object} → ${cell.count} 篇`);
    }
  }

  lines.push('');
  lines.push('【覆盖空缺（方法 × 对象 从未组合，按显著度排序）】');
  if (matrix.holes.length === 0) {
    lines.push('（无明显空缺）');
  } else {
    for (const hole of matrix.holes) {
      lines.push(
        `- ${hole.method} × ${hole.object} → 空缺（该方法出现 ${hole.methodCount} 次，该对象出现 ${hole.objectCount} 次）`
      );
    }
  }

  return lines.join('\n');
}

/* ── 内部工具 ── */

function countOccurrences(
  members: MatrixMemberInput[],
  pick: (member: MatrixMemberInput) => string[]
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const member of members) {
    for (const key of unique(pick(member))) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

function pickFrequent(counts: Map<string, number>, minCount: number): string[] {
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

function unique(keys: string[]): string[] {
  return [...new Set(keys.filter((key) => key.length > 0))];
}
