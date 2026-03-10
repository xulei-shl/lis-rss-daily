/**
 * 推送类型常量
 *
 * 统一的推送类型定义，用于 Telegram 和 WeChat 通知
 */

/**
 * 推送类型枚举
 */
export type PushType = 'daily_summary' | 'journal_all' | 'new_articles';

/**
 * 推送类型常量
 */
export const PUSH_TYPES = {
  DAILY_SUMMARY: 'daily_summary' as const,
  JOURNAL_ALL: 'journal_all' as const,
  NEW_ARTICLES: 'new_articles' as const,
} as const;

/**
 * 推送类型中文标签
 */
export const PUSH_TYPE_LABELS: Record<PushType, string> = {
  daily_summary: '每日总结（通过的期刊 + 资讯）',
  journal_all: '全部期刊总结（包含未通过）',
  new_articles: '新增文章通知',
} as const;

/**
 * 所有有效的推送类型数组（用于运行时验证）
 */
export const VALID_PUSH_TYPES: PushType[] = ['daily_summary', 'journal_all', 'new_articles'] as const;
