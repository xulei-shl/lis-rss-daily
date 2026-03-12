"use strict";
/**
 * 时间格式化辅助：将 SQLite 默认的 `YYYY-MM-DD HH:MM:SS`（无时区）转换为 ISO UTC 字符串
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTimestamp = normalizeTimestamp;
exports.normalizeDateFields = normalizeDateFields;
var BASIC_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
var HAS_TIMEZONE_RE = /(Z|[+-]\d{2}:\d{2})$/i;
/**
 * 将数据库返回的时间字符串标准化为 ISO8601（UTC）
 */
function normalizeTimestamp(value) {
    if (!value)
        return value;
    if (HAS_TIMEZONE_RE.test(value)) {
        return value;
    }
    if (BASIC_DATE_TIME_RE.test(value)) {
        var replaced = value.replace(' ', 'T');
        return replaced.endsWith('Z') ? replaced : "".concat(replaced, "Z");
    }
    return value;
}
/**
 * 批量标准化对象中的时间字段（原地修改并返回对象，便于链式调用）
 */
function normalizeDateFields(entity, fields) {
    if (!entity)
        return entity;
    for (var _i = 0, fields_1 = fields; _i < fields_1.length; _i++) {
        var field = fields_1[_i];
        var key = field;
        var current = entity[key];
        if (typeof current === 'string') {
            var normalized = normalizeTimestamp(current);
            if (normalized !== current) {
                entity[key] = normalized;
            }
        }
    }
    return entity;
}
