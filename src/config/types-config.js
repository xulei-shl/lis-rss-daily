"use strict";
/**
 * 类型配置加载器
 *
 * 从 YAML 文件加载类型定义，提供类型安全的访问接口
 *
 * 单一真实来源 (SSOT) - 所有类型枚举从 config/types.yaml 加载
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTaskTypeCodes = getTaskTypeCodes;
exports.getTaskTypeConfig = getTaskTypeConfig;
exports.getTaskTypeLabels = getTaskTypeLabels;
exports.getSourceTypeCodes = getSourceTypeCodes;
exports.getSourceTypeConfig = getSourceTypeConfig;
exports.getSourceTypePriority = getSourceTypePriority;
exports.getSourceTypeLabels = getSourceTypeLabels;
exports.getDefaultSourceType = getDefaultSourceType;
exports.getTypeConfigForAPI = getTypeConfigForAPI;
exports.reloadConfig = reloadConfig;
var fs_1 = require("fs");
var path_1 = require("path");
var js_yaml_1 = require("js-yaml");
// 单例缓存
var _config = null;
/**
 * 加载并解析 YAML 配置文件
 */
function loadConfig() {
    if (_config) {
        return _config;
    }
    var configPath = path_1.default.join(process.cwd(), 'config', 'types.yaml');
    if (!fs_1.default.existsSync(configPath)) {
        throw new Error("\u7C7B\u578B\u914D\u7F6E\u6587\u4EF6\u672A\u627E\u5230: ".concat(configPath));
    }
    var yamlContent = fs_1.default.readFileSync(configPath, 'utf-8');
    _config = js_yaml_1.default.load(yamlContent);
    return _config;
}
// ============================================================================
// 任务类型相关函数
// ============================================================================
/**
 * 获取所有已启用的任务类型代码（按优先级排序）
 */
function getTaskTypeCodes() {
    var config = loadConfig();
    return Object.values(config.task_types)
        .filter(function (t) { return t.enabled; })
        .sort(function (a, b) { return a.priority - b.priority; })
        .map(function (t) { return t.code; });
}
/**
 * 根据代码获取任务类型配置
 */
function getTaskTypeConfig(code) {
    var config = loadConfig();
    return Object.values(config.task_types).find(function (t) { return t.code === code; });
}
/**
 * 获取任务类型标签映射
 */
function getTaskTypeLabels() {
    var config = loadConfig();
    var result = {};
    for (var _i = 0, _a = Object.values(config.task_types); _i < _a.length; _i++) {
        var type = _a[_i];
        result[type.code] = type.label;
    }
    return result;
}
// ============================================================================
// 源类型相关函数
// ============================================================================
/**
 * 获取所有源类型代码（按优先级排序）
 */
function getSourceTypeCodes() {
    var config = loadConfig();
    return Object.values(config.source_types)
        .sort(function (a, b) { return a.priority - b.priority; })
        .map(function (t) { return t.code; });
}
/**
 * 根据代码获取源类型配置
 */
function getSourceTypeConfig(code) {
    var config = loadConfig();
    return Object.values(config.source_types).find(function (t) { return t.code === code; });
}
/**
 * 获取源类型优先级映射
 */
function getSourceTypePriority() {
    var config = loadConfig();
    var result = {};
    for (var _i = 0, _a = Object.values(config.source_types); _i < _a.length; _i++) {
        var type = _a[_i];
        result[type.code] = type.priority;
    }
    return result;
}
/**
 * 获取源类型标签映射
 */
function getSourceTypeLabels() {
    var config = loadConfig();
    var result = {};
    for (var _i = 0, _a = Object.values(config.source_types); _i < _a.length; _i++) {
        var type = _a[_i];
        result[type.code] = type.label;
    }
    return result;
}
/**
 * 获取默认源类型
 */
function getDefaultSourceType() {
    var config = loadConfig();
    var defaultType = Object.values(config.source_types).find(function (t) { return t.default; });
    return (defaultType === null || defaultType === void 0 ? void 0 : defaultType.code) || 'blog';
}
// ============================================================================
// 通用函数
// ============================================================================
/**
 * 获取完整的类型配置（用于 API 响应）
 */
function getTypeConfigForAPI() {
    return loadConfig();
}
/**
 * 重新加载配置（开发时使用）
 */
function reloadConfig() {
    _config = null;
}
