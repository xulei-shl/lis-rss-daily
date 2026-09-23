/**
 * 环境变量数值解析 — 单一共享实现
 *
 * `parseInt` / `parseFloat` 对缺失、空白或非数字输入会返回 NaN，直接使用会让
 * 下游静默失效：NaN 参与分批循环会切出空批次、参与 setTimeout 会立即超时，
 * 负数还可能造成死循环。统一在这里兜底回默认值。
 *
 * 这些函数不依赖 logger，避免与 logger / config 形成循环引用。
 */

/**
 * 读取整数环境变量。
 *
 * 缺失、空白、非数字或小于 `min` 时回退到 `fallback`。
 *
 * @param value    原始值，通常为 `process.env.XXX`
 * @param fallback 默认值
 * @param min      允许的最小值（默认 0；传 1 表示 0 也不合法）
 */
export function intEnv(value: string | undefined, fallback: number, min = 0): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

/**
 * 读取浮点数环境变量。
 *
 * 缺失、空白、非数字或小于 `min` 时回退到 `fallback`。
 */
export function floatEnv(value: string | undefined, fallback: number, min = 0): number {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}
