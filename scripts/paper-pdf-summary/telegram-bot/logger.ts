/**
 * Simple logger with timestamp + level.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const level = (process.env.LOG_LEVEL || 'info') as LogLevel;
const LOG_PRIORITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(l: LogLevel): boolean {
  return LOG_PRIORITY[l] >= LOG_PRIORITY[level];
}

function fmt(l: LogLevel, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${l.toUpperCase()}] ${msg}${metaStr}`;
}

export const log = {
  debug(msg: string, meta?: Record<string, unknown>): void {
    if (shouldLog('debug')) console.log(fmt('debug', msg, meta));
  },
  info(msg: string, meta?: Record<string, unknown>): void {
    if (shouldLog('info')) console.log(fmt('info', msg, meta));
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    if (shouldLog('warn')) console.warn(fmt('warn', msg, meta));
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    if (shouldLog('error')) console.error(fmt('error', msg, meta));
  },
};
