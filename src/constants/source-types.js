"use strict";
/**
 * RSS 源类型常量
 *
 * 从 YAML 配置文件加载类型定义
 * 保持向后兼容的 API
 *
 * 单一真实来源 (SSOT): config/types.yaml
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SOURCE_TYPE = exports.VALID_SOURCE_TYPES = exports.SOURCE_TYPE_LABELS = exports.SOURCE_TYPE_PRIORITY = exports.SOURCE_TYPES = void 0;
var types_config_js_1 = require("../config/types-config.js");
// 动态构建 SOURCE_TYPES 常量
var typeCodes = (0, types_config_js_1.getSourceTypeCodes)();
var SOURCE_TYPES_OBJ = {};
for (var _i = 0, typeCodes_1 = typeCodes; _i < typeCodes_1.length; _i++) {
    var code = typeCodes_1[_i];
    SOURCE_TYPES_OBJ[code.toUpperCase()] = code;
}
/**
 * RSS 源类型常量
 */
exports.SOURCE_TYPES = SOURCE_TYPES_OBJ;
/**
 * RSS 源类型优先级（数字越小优先级越高）
 */
exports.SOURCE_TYPE_PRIORITY = (0, types_config_js_1.getSourceTypePriority)();
/**
 * RSS 源类型中文标签
 */
exports.SOURCE_TYPE_LABELS = (0, types_config_js_1.getSourceTypeLabels)();
/**
 * 所有有效的源类型值数组（用于运行时验证）
 */
exports.VALID_SOURCE_TYPES = (0, types_config_js_1.getSourceTypeCodes)();
/**
 * 默认源类型
 */
exports.DEFAULT_SOURCE_TYPE = (0, types_config_js_1.getDefaultSourceType)();
