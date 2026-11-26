/**
 * 定时计划的「下一次触发时间」计算。
 *
 * 只服务于页面展示（/clusters 顶部统计条），因此支持标准 5 段 cron 的常用写法
 * （通配、区间、步长与逗号列表），不做复杂扩展。
 * 采用逐分钟向前探测，探测上限 14 天；非法表达式返回 null，不抛错。
 */

const MAX_SCAN_MINUTES = 14 * 24 * 60;

interface CronField {
  values: Set<number>;
  wildcard: boolean;
}

function parseField(field: string, min: number, max: number): CronField {
  const values = new Set<number>();
  let wildcard = false;

  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`非法步长：${part}`);
    }

    let start: number;
    let end: number;
    if (rangePart === '*') {
      wildcard = true;
      start = min;
      end = max;
    } else if (rangePart.includes('-')) {
      const [from, to] = rangePart.split('-').map(Number);
      start = from;
      end = to;
    } else {
      start = Number(rangePart);
      end = stepPart === undefined ? start : max;
    }

    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      throw new Error(`非法区间：${part}`);
    }

    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }

  return { values, wildcard };
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

function readZonedParts(
  formatter: Intl.DateTimeFormat,
  date: Date
): ZonedParts {
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/**
 * 计算 cron 表达式在指定时区下的下一次触发时间。
 * 表达式非法或不支持时返回 null。
 */
export function computeNextCronRun(
  expression: string,
  timezone: string,
  from: Date = new Date()
): Date | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  let minute: CronField;
  let hour: CronField;
  let dayOfMonth: CronField;
  let month: CronField;
  let dayOfWeek: CronField;
  try {
    minute = parseField(parts[0], 0, 59);
    hour = parseField(parts[1], 0, 23);
    dayOfMonth = parseField(parts[2], 1, 31);
    month = parseField(parts[3], 1, 12);
    dayOfWeek = parseField(parts[4], 0, 6);
  } catch {
    return null;
  }
  if (parts[4].includes('7')) {
    // 标准 cron 中 7 也表示周日
    dayOfWeek.values.add(0);
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const domRestricted = !dayOfMonth.wildcard;
  const dowRestricted = !dayOfWeek.wildcard;

  const start = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  for (let i = 0; i < MAX_SCAN_MINUTES; i += 1) {
    const candidate = new Date(start + i * 60_000);
    const zoned = readZonedParts(formatter, candidate);
    if (
      !minute.values.has(zoned.minute) ||
      !hour.values.has(zoned.hour) ||
      !month.values.has(zoned.month)
    ) {
      continue;
    }

    const dayMatches =
      domRestricted && dowRestricted
        ? dayOfMonth.values.has(zoned.day) || dayOfWeek.values.has(zoned.weekday)
        : domRestricted
          ? dayOfMonth.values.has(zoned.day)
          : dowRestricted
            ? dayOfWeek.values.has(zoned.weekday)
            : true;
    if (dayMatches) return candidate;
  }

  return null;
}

/** 将触发时间格式化为 `MM-DD HH:mm`（指定时区） */
export function formatRunTimeLabel(date: Date, timezone: string): string {
  const parts: Record<string, string> = {};
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
