/**
 * 时间格式化辅助：将 SQLite 默认的 `YYYY-MM-DD HH:MM:SS`（无时区）转换为 ISO UTC 字符串
 */

const BASIC_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const HAS_TIMEZONE_RE = /(Z|[+-]\d{2}:\d{2})$/i;

/**
 * 将数据库返回的时间字符串标准化为 ISO8601（UTC）
 */
export function normalizeTimestamp(value: string | null | undefined): string | null | undefined {
  if (!value) return value;
  if (HAS_TIMEZONE_RE.test(value)) {
    return value;
  }
  if (BASIC_DATE_TIME_RE.test(value)) {
    const replaced = value.replace(' ', 'T');
    return replaced.endsWith('Z') ? replaced : `${replaced}Z`;
  }
  return value;
}

/**
 * 批量标准化对象中的时间字段（原地修改并返回对象，便于链式调用）
 */
export function normalizeDateFields<T extends Record<string, any>>(
  entity: T,
  fields: Array<keyof T | string>
): T {
  if (!entity) return entity;
  for (const field of fields) {
    const key = field as keyof T;
    const current = entity[key];
    if (typeof current === 'string') {
      const normalized = normalizeTimestamp(current);
      if (normalized !== current) {
        (entity as any)[key] = normalized;
      }
    }
  }
  return entity;
}
