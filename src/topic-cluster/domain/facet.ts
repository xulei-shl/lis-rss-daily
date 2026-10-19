/**
 * 切面相关的纯函数（无 IO）。
 *
 * 职责：
 *   1. 由结构化切面拼出用于 embedding 的文本（**不是**全文总结原文）；
 *   2. 把 method / study_object 切成可比较的键，供方法×对象矩阵与熵计算使用；
 *   3. 解析统一事件时间与精度标记。
 */

/** 切面契约（与设计文档 §7.1 一致） */
export interface FacetFields {
  research_question: string;
  method: string;
  study_object: string;
  core_finding: string;
  limitation?: string;
  angle_hint?: string;
  evidence_quotes?: string[];
}

export type DatePrecision = 'day' | 'year' | 'ingest';

/**
 * 解析落库的 facet_json。
 *
 * 字段不完整的历史数据一律视为无效返回 null——聚类不能基于半个切面运行。
 */
export function parseFacetFields(json: string | null | undefined): FacetFields | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const question = readField(record.research_question);
  const method = readField(record.method);
  const object = readField(record.study_object);
  const finding = readField(record.core_finding);
  if (!question || !method || !object || !finding) return null;

  return {
    research_question: question,
    method,
    study_object: object,
    core_finding: finding,
    limitation: readField(record.limitation) ?? undefined,
    angle_hint: readField(record.angle_hint) ?? undefined,
    evidence_quotes: Array.isArray(record.evidence_quotes)
      ? record.evidence_quotes.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function readField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 拼接用于 embedding 的切面文本。
 *
 * 刻意只取「问题 / 方法 / 对象 / 发现」四个判别性字段：
 *   - 语义聚焦，避免全文总结的背景叙述噪声；
 *   - 长度稳定，不受原文长度差异（26~9811 字符）影响。
 */
export function buildFacetText(facet: FacetFields): string {
  return [
    `QUESTION: ${facet.research_question}`.trim(),
    `METHOD: ${facet.method}`.trim(),
    `OBJECT: ${facet.study_object}`.trim(),
    `FINDING: ${facet.core_finding}`.trim(),
  ].join('\n');
}

const KEY_SEPARATORS = /[+＋、,，;；/|｜]/;

/**
 * 把一个自由文本字段切成可比较的键。
 *
 * 例：「眼动实验 + 问卷调查(N=420)」→ ["眼动实验", "问卷调查(n=420)"]
 *
 * 括号内的分隔符**不切**：`study_object` 的规范写法是「通用类别（具体样本）」，
 * 括号里的补充说明含顿号时会碎成一堆无意义键（实测出现过一篇被切成 4 个碎片键）。
 */
export function splitKeys(value: string | null | undefined): string[] {
  if (!value) return [];
  const keys = splitOutsideBrackets(value)
    .flatMap((part) => part.split(/\s{2,}/))
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 2);
  return [...new Set(keys)];
}

/** 按分隔符切分，但括号（中英文）内的分隔符保留原文 */
function splitOutsideBrackets(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of value) {
    if (char === '（' || char === '(') depth += 1;
    else if (char === '）' || char === ')') depth = Math.max(0, depth - 1);

    if (depth === 0 && KEY_SEPARATORS.test(char)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** 两组键是否有交集（用于 shared_method / shared_object 判定） */
export function sharesAny(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  for (const key of b) {
    if (set.has(key)) return true;
  }
  return false;
}

export interface EventDateInput {
  published_at?: string | null;
  published_year?: number | null;
  created_at?: string | null;
}

export interface EventDateResult {
  eventDate: string | null;
  precision: DatePrecision;
}

/**
 * 解析统一事件时间与精度。
 *
 * 精度必须显式记录：把日级（RSS/邮件）与年级（CNKI 期刊）数据混在一起
 * 而不加标记，会静默产生假趋势（见设计文档 §4.2）。
 */
export function resolveEventDate(input: EventDateInput): EventDateResult {
  const publishedAt = toIso(input.published_at);
  if (publishedAt) return { eventDate: publishedAt, precision: 'day' };

  const created = toIso(input.created_at);
  const year = typeof input.published_year === 'number' ? input.published_year : null;

  if (year && year > 1900 && year < 2200) {
    // 年级精度取年中值作为占位，避免被当成 1 月导致排序偏差
    return { eventDate: `${year}-06-15T00:00:00.000Z`, precision: 'year' };
  }

  if (created) return { eventDate: created, precision: 'ingest' };
  return { eventDate: null, precision: 'ingest' };
}

/** 宽松解析为 ISO 字符串，失败返回 null */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
