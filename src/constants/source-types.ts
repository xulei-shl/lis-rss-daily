/**
 * RSS 源类型常量
 *
 * 单一真实来源（SSOT）：定义所有支持的 RSS 源类型
 * 新增类型时只需修改此文件
 */

export const SOURCE_TYPES = {
  JOURNAL: 'journal',
  BLOG: 'blog',
  NEWS: 'news',
} as const;

/**
 * RSS 源类型
 */
export type SourceType = (typeof SOURCE_TYPES)[keyof typeof SOURCE_TYPES];

/**
 * RSS 源类型优先级（数字越小优先级越高）
 */
export const SOURCE_TYPE_PRIORITY: Record<SourceType, number> = {
  journal: 1,
  blog: 2,
  news: 3,
};

/**
 * RSS 源类型中文标签
 */
export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  journal: '期刊',
  blog: '博客',
  news: '资讯',
};

/**
 * 所有有效的源类型值数组（用于运行时验证）
 */
export const VALID_SOURCE_TYPES = Object.values(SOURCE_TYPES) as SourceType[];

/**
 * 默认源类型
 */
export const DEFAULT_SOURCE_TYPE: SourceType = SOURCE_TYPES.BLOG;
