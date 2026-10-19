/**
 * 统计与趋势指标（纯函数，无 IO）。
 */

/** 香农熵（输入为各类别计数）。值越大表示分布越分散 */
export function entropy(counts: number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return 0;
  let value = 0;
  for (const count of counts) {
    if (count <= 0) continue;
    const p = count / total;
    value -= p * Math.log2(p);
  }
  return value;
}

/** 质心位移量 = 1 - cos(prev, curr)，范围 [0, 2] */
export function centroidDrift(prev: ArrayLike<number>, curr: ArrayLike<number>): number {
  const len = Math.min(prev.length, curr.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    dot += prev[i] * curr[i];
    normA += prev[i] * prev[i];
    normB += curr[i] * curr[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** 按时间中位数把有序数组切成前后两段 */
export function splitByMedian<T>(sorted: T[]): { first: T[]; second: T[] } {
  if (sorted.length < 2) return { first: sorted, second: [] };
  const mid = Math.floor(sorted.length / 2);
  return { first: sorted.slice(0, mid), second: sorted.slice(mid) };
}

export type Trend = 'up' | 'flat' | 'down';

/**
 * 趋势判定：比较后半段与前半段的文章密度。
 *
 * @returns 样本不足时返回 null（前端显示「样本不足」，不输出确定结论）
 */
export function trendLabel(
  firstHalfCount: number,
  secondHalfCount: number,
  minSamples: number,
  upRatio: number,
  downRatio: number
): Trend | null {
  const total = firstHalfCount + secondHalfCount;
  if (total < minSamples) return null;
  const ratio = secondHalfCount / Math.max(firstHalfCount, 1);
  if (ratio >= upRatio) return 'up';
  if (ratio <= downRatio) return 'down';
  return 'flat';
}

/** 从 ISO 日期串取 'YYYY-MM'，无效输入返回 null */
export function toPeriod(date: string | null | undefined): string | null {
  if (!date || date.length < 7) return null;
  const period = date.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(period) ? period : null;
}

/** 两个时期之间的月份差（用于时效缺口判定）；无效输入返回 null */
export function monthsBetween(fromPeriod: string, toPeriod_: string): number | null {
  const from = parsePeriod(fromPeriod);
  const to = parsePeriod(toPeriod_);
  if (!from || !to) return null;
  return (to.year - from.year) * 12 + (to.month - from.month);
}

function parsePeriod(period: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}
