/**
 * RSS 源类型常量
 *
 * 从 YAML 配置文件加载类型定义
 * 保持向后兼容的 API
 *
 * 单一真实来源 (SSOT): config/types.yaml
 */

import {
  getSourceTypeCodes,
  getSourceTypePriority,
  getSourceTypeLabels,
  getDefaultSourceType,
} from '../config/types-config.js';

// 动态构建 SOURCE_TYPES 常量
const typeCodes = getSourceTypeCodes();
const SOURCE_TYPES_OBJ: Record<string, string> = {};

for (const code of typeCodes) {
  SOURCE_TYPES_OBJ[code.toUpperCase()] = code;
}

/**
 * RSS 源类型常量
 */
export const SOURCE_TYPES = SOURCE_TYPES_OBJ as {
  JOURNAL: 'journal';
  BLOG: 'blog';
  NEWS: 'news';
  // 未来新增类型会自动添加
};

/**
 * RSS 源类型
 */
export type SourceType = (typeof SOURCE_TYPES)[keyof typeof SOURCE_TYPES];

/**
 * RSS 源类型优先级（数字越小优先级越高）
 */
export const SOURCE_TYPE_PRIORITY: Record<SourceType, number> = getSourceTypePriority() as Record<SourceType, number>;

/**
 * RSS 源类型中文标签
 */
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = getSourceTypeLabels() as Record<SourceType, string>;

/**
 * 所有有效的源类型值数组（用于运行时验证）
 */
export const VALID_SOURCE_TYPES = getSourceTypeCodes() as SourceType[];

/**
 * 默认源类型
 */
export const DEFAULT_SOURCE_TYPE: SourceType = getDefaultSourceType() as SourceType;
