/**
 * Telegram Command Parser
 *
 * Parses and validates command arguments for Telegram bot commands.
 */

export interface GetArticlesDateCommand {
  type: 'date';
  year: number;
  month: number;
  day: number;
}

export interface GetArticlesSourceCommand {
  type: 'source';
  name: string;
}

export type GetArticlesCommand = GetArticlesDateCommand | GetArticlesSourceCommand;

/**
 * Parse /getarticles command arguments
 * Supported formats:
 * - Date: YYYY-M-D (e.g., 2026-3-1), YYYY-MM-DD (e.g., 2026-03-01), YYYYMMDD (e.g., 20260301)
 * - Source: any non-date string (e.g., "MIT Technology Review", "关键词: 人工智能")
 */
export function parseGetArticlesCommand(args: string): GetArticlesCommand | null {
  if (!args || args.trim() === '') {
    return null;
  }

  const trimmed = args.trim();

  // Try to parse as date first
  const dateMatch = tryParseDate(trimmed);
  if (dateMatch) {
    return { type: 'date', ...dateMatch };
  }

  // Not a date format, treat as source name
  return { type: 'source', name: trimmed };
}

/**
 * Try to parse input as a date
 * @returns Date components or null if not a valid date
 */
function tryParseDate(input: string): { year: number; month: number; day: number } | null {
  // Try YYYY-MM-DD format (flexible: YYYY-M-D or YYYY-MM-DD)
  let match = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  // Try YYYYMMDD format
  if (!match) {
    match = input.match(/^(\d{4})(\d{2})(\d{2})$/);
  }

  if (!match) {
    return null;
  }

  const [, yearStr, monthStr, dayStr] = match;
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Validate ranges
  if (year < 2000 || year > 2100) {
    return null;
  }

  if (month < 1 || month > 12) {
    return null;
  }

  // Validate day based on month
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) {
    return null;
  }

  return { year, month, day };
}
