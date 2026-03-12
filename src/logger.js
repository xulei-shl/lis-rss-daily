"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.initLogger = initLogger;
var pino_1 = require("pino");
var pino_pretty_1 = require("pino-pretty");
var fs_1 = require("fs");
var path_1 = require("path");
var _logger = null;
var _cleanupTimer = null;
/** 获取今天的日期字符串 YYYY-MM-DD */
function getDateStr() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, '0');
    var day = String(now.getDate()).padStart(2, '0');
    return "".concat(year, "-").concat(month, "-").concat(day);
}
/** 清理过期日志文件 */
function cleanupOldLogs(logDir, logBaseName, retentionDays) {
    try {
        var files = fs_1.default.readdirSync(logDir);
        var now = Date.now();
        var maxAge = retentionDays * 24 * 60 * 60 * 1000;
        for (var _i = 0, files_1 = files; _i < files_1.length; _i++) {
            var file = files_1[_i];
            if (!file.startsWith(logBaseName))
                continue;
            var filePath = path_1.default.join(logDir, file);
            var stats = fs_1.default.statSync(filePath);
            var age = now - stats.mtimeMs;
            if (age > maxAge) {
                fs_1.default.unlinkSync(filePath);
            }
        }
    }
    catch (_a) {
        // 忽略清理错误
    }
}
function createLogger() {
    var level = process.env.LOG_LEVEL || 'info';
    var logFile = process.env.LOG_FILE;
    var retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '7', 10);
    // Pretty stream for stdout
    var prettyStream = (0, pino_pretty_1.default)({ colorize: true });
    if (!logFile) {
        return (0, pino_1.default)({ level: level }, prettyStream);
    }
    // File stream with date suffix (e.g., app.log -> app.2025-02-12.log)
    var absPath = path_1.default.resolve(logFile);
    var logDir = path_1.default.dirname(absPath);
    var logName = path_1.default.basename(absPath);
    var ext = path_1.default.extname(logName);
    var baseName = path_1.default.basename(logName, ext);
    fs_1.default.mkdirSync(logDir, { recursive: true });
    var dateStr = getDateStr();
    var rotatedPath = path_1.default.join(logDir, "".concat(baseName, ".").concat(dateStr).concat(ext));
    var fileStream = fs_1.default.createWriteStream(rotatedPath, { flags: 'a' });
    // 每天凌晨清理过期日志
    if (_cleanupTimer)
        clearInterval(_cleanupTimer);
    _cleanupTimer = setInterval(function () {
        cleanupOldLogs(logDir, "".concat(baseName, "."), retentionDays);
    }, 60 * 60 * 1000); // 每小时检查一次
    var multistream = pino_1.default.multistream([
        { level: level, stream: prettyStream },
        { level: level, stream: fileStream },
    ]);
    return (0, pino_1.default)({ level: level }, multistream);
}
/**
 * Initialize the logger. Must be called after dotenv.config().
 */
function initLogger() {
    _logger = createLogger();
}
/**
 * Get the logger instance. Auto-initializes if not yet done.
 */
exports.logger = new Proxy({}, {
    get: function (_target, prop) {
        if (!_logger) {
            _logger = createLogger();
        }
        return _logger[prop];
    },
});
