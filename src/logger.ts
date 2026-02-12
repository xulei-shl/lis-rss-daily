/**
 * Logger: pino-based logging with optional file output.
 *
 * ENV:
 *   LOG_FILE — path to log file (JSON lines). Only written when set.
 *   LOG_LEVEL — log level (default: "info"). Set to "debug" for verbose output.
 *   LOG_RETENTION_DAYS — number of log files to keep (default: 7)
 *
 * Call initLogger() after dotenv.config() to pick up env vars.
 */

import pino from 'pino';
import pinoPretty from 'pino-pretty';
import fs from 'fs';
import path from 'path';

let _logger: pino.Logger | null = null;
let _cleanupTimer: NodeJS.Timeout | null = null;

/** 获取今天的日期字符串 YYYY-MM-DD */
function getDateStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 清理过期日志文件 */
function cleanupOldLogs(logDir: string, logBaseName: string, retentionDays: number): void {
  try {
    const files = fs.readdirSync(logDir);
    const now = Date.now();
    const maxAge = retentionDays * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.startsWith(logBaseName)) continue;

      const filePath = path.join(logDir, file);
      const stats = fs.statSync(filePath);
      const age = now - stats.mtimeMs;

      if (age > maxAge) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // 忽略清理错误
  }
}

function createLogger(): pino.Logger {
  const level = process.env.LOG_LEVEL || 'info';
  const logFile = process.env.LOG_FILE;
  const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '7', 10);

  // Pretty stream for stdout
  const prettyStream = pinoPretty({ colorize: true });

  if (!logFile) {
    return pino({ level }, prettyStream);
  }

  // File stream with date suffix (e.g., app.log -> app.2025-02-12.log)
  const absPath = path.resolve(logFile);
  const logDir = path.dirname(absPath);
  const logName = path.basename(absPath);
  const ext = path.extname(logName);
  const baseName = path.basename(logName, ext);

  fs.mkdirSync(logDir, { recursive: true });

  const dateStr = getDateStr();
  const rotatedPath = path.join(logDir, `${baseName}.${dateStr}${ext}`);
  const fileStream = fs.createWriteStream(rotatedPath, { flags: 'a' });

  // 每天凌晨清理过期日志
  if (_cleanupTimer) clearInterval(_cleanupTimer);
  _cleanupTimer = setInterval(() => {
    cleanupOldLogs(logDir, `${baseName}.`, retentionDays);
  }, 60 * 60 * 1000); // 每小时检查一次

  const multistream = pino.multistream([
    { level: level as pino.Level, stream: prettyStream },
    { level: level as pino.Level, stream: fileStream },
  ]);

  return pino({ level }, multistream);
}

/**
 * Initialize the logger. Must be called after dotenv.config().
 */
export function initLogger(): void {
  _logger = createLogger();
}

/**
 * Get the logger instance. Auto-initializes if not yet done.
 */
export const logger = new Proxy({} as pino.Logger, {
  get(_target, prop) {
    if (!_logger) {
      _logger = createLogger();
    }
    return (_logger as any)[prop];
  },
});
