/**
 * 短哈希工具（纯函数）。
 *
 * 用途：
 *   - 生成主题 slug 的稳定后缀；
 *   - 生成角度 angle_key（避免 LLM 改名导致漂移）；
 *   - 生成分析的 input_hash（审计用）。
 *
 * 非加密用途，不追求抗碰撞，只要求同输入稳定同输出。
 */

/** FNV-1a 32 位哈希，返回固定长度的小写十六进制串 */
export function shortHash(input: string, length = 8): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return hex.slice(0, Math.max(1, Math.min(length, 8))).padEnd(length, '0');
}
