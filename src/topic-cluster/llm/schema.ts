/**
 * LLM 输出校验工具（纯函数，无 IO）。
 *
 * 本模块的核心纪律（设计文档 §7.7、风险 R4）：
 *   **宁可让某个主题本轮分析失败，也不把占位文本或越界引用写进库。**
 *
 * 因此这里不提供任何「兜底默认值」——校验不通过一律抛 ClusterSchemaError，
 * 由调用方决定写 `status='failed'` 还是重试。
 */

/** 校验失败。消息需包含足够上下文，便于日志定位是哪一篇/哪个主题 */
export class ClusterSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClusterSchemaError';
  }
}

/**
 * 占位符与空话特征。
 *
 * 与设计文档一致：这些文本一旦落库，用户会看到「看起来像结论、实际没信息」的内容，
 * 比不展示更差，因此必须拒收。
 *
 * ⚠️ 三次踩过的坑（按时间顺序，每次都是上一版判据的漏洞）：
 *   1. 最切用首尾锚定的精确匹配（`/^(未明确)$/`）→ 模型在**看不到任何输入**时
 *      把四字段全填成「未明确说明」，差两个字就顺利过验，全库写进一批垃圾切面；
 *   2. 改成「剥一层后缀」后，「暂无相关数据」「暂无统一结论」仍是漏洞；
 *   3. 改成「剔掉占位/套话词后看剩余量」后，**误伤了合法术语**：
 *      「内容分析」剔掉「内容」只剩 2 字 → 被判占位而整篇拒收（实测 200 篇里挂了 3 篇）。
 *      根因是「内容 / 数据 / 信息」这些通用名词**既是套话的主语，也是正经术语的成分**。
 *
 * 因此判据拆成两类词，并加一个前提：
 *   - `UNKNOWN_MARKERS`：**「不知道」标记**（未明确 / 暂无 / 无法判断 …）
 *   - `PADDING_TOKENS`：套话名词（内容 / 数据 / 信息 …），**只能用于算剩余量**
 *
 *   「未明确说明」→ 有标记，剔光 → 拒收
 *   「暂无相关数据」→ 有标记，剔光 → 拒收
 *   「无显著影响」→ 无标记 → 放行（不误伤合法的短结论）
 *   「未明确提及样本量，但补充说明了两所高校」→ 有标记但剩大量实质内容 → 放行
 *   「内容分析」→ **无标记**，剔掉「内容」后剩「分析」 → 放行（合法方法词）
 *   「相关内容」→ 无标记但剔完是空 → 拒收（全是套话）
 */
const UNKNOWN_MARKERS = [
  '未明确',
  '未说明',
  '未提供',
  '未提及',
  '未涉及',
  '未指定',
  '尚未',
  '暂无',
  '无法判断',
  '无从判断',
  '不确定',
  '不适用',
  '待补充',
  '待定',
  '未知',
  '无法',
  '无从',
  'n/a',
  'none',
  'null',
  'tbd',
  'todo',
] as const;

/** 套话名词：既是空话的主语，也是正经术语的成分，**只能拿来算剩余量，不能单独当判据** */
const PADDING_TOKENS = [
  '明确',
  '说明',
  '提供',
  '提及',
  '涉及',
  '判断',
  '数据',
  '内容',
  '信息',
  '描述',
  '结论',
  '相关',
  '统一',
  '略',
  '无',
] as const;

/** 剥离后剩下的实质字符（去掉标点与空白）少于该阈值即判为占位（仅在出现未知标记时生效） */
const MIN_SUBSTANTIVE_CHARS = 3;

const PLACEHOLDER_INLINE = /占位|placeholder/i;
const TEMPLATE_LEFTOVER = /^(\{\{.*\}\}|\$\{.*\})$/;
const PUNCTUATION_OR_SPACE = /[\s，,。.；;：:、！!？?（）()【】\[\]「」“”"'—-]/g;

/** 是否为占位符/空话文本 */
export function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return true;
  if (PLACEHOLDER_INLINE.test(trimmed)) return true;
  if (TEMPLATE_LEFTOVER.test(trimmed)) return true;

  // 全程在 lower 上计算：ASCII 标记（tbd / n/a / none）才不吃大小写，长度与原文一致
  const lower = trimmed.toLowerCase();
  const withoutMarker = stripTokens(lower, UNKNOWN_MARKERS);
  const substantive = stripTokens(withoutMarker, PADDING_TOKENS).replace(PUNCTUATION_OR_SPACE, '');

  // 有「不知道」标记：剔光标记与套话后剩余不足 3 字 → 占位
  if (UNKNOWN_MARKERS.some((marker) => lower.includes(marker))) {
    return substantive.length < MIN_SUBSTANTIVE_CHARS;
  }

  // 无标记：只有「全是套话名词」才拒收（「相关内容」），
  // 剩下任何实质内容一律放行——否则会误伤「内容分析」「数据分析」这类合法术语
  return substantive.length === 0;
}

/** 逐个 token 从字符串中剔除（不用正则，避免转义与「长词被短词先吃掉」的顺序陷阱） */
function stripTokens(value: string, tokens: readonly string[]): string {
  let out = value;
  for (const token of tokens) out = out.split(token).join('');
  return out;
}

/** 必填字符串：非空、非占位符、有最小长度 */
export function requireText(value: unknown, field: string, minLength = 2): string {
  if (typeof value !== 'string') {
    throw new ClusterSchemaError(`字段 ${field} 缺失或类型错误（期望字符串）`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new ClusterSchemaError(`字段 ${field} 过短（${trimmed.length} < ${minLength}）`);
  }
  if (trimmed.length > 600) {
    throw new ClusterSchemaError(`字段 ${field} 过长（${trimmed.length} > 600）`);
  }
  if (isPlaceholder(trimmed)) {
    throw new ClusterSchemaError(`字段 ${field} 为占位符文本：「${trimmed}」`);
  }
  return trimmed;
}

/** 可选字符串：空/占位符一律归一为 null */
export function optionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || isPlaceholder(trimmed)) return null;
  return trimmed;
}

/** 字符串数组：过滤掉非字符串、空串与占位符 */
export function textArray(value: unknown, maxItems = 20): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = optionalText(item);
    if (text) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * 引用白名单校验（设计文档 §7.7 硬性要求）。
 *
 * @returns 过滤后的合法 id；若原数组非空但全部非法，返回空数组由调用方决定是否丢弃整条
 */
export function filterAllowedIds(value: unknown, allowed: ReadonlySet<number>): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const id = typeof item === 'number' ? item : Number(item);
    if (!Number.isFinite(id)) continue;
    if (allowed.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 枚举校验：不在集合内时返回 fallback */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return fallback;
}
