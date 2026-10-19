/**
 * 推送类型常量
 *
 * 推送类型的唯一来源：设置页、API 校验、企业微信 YAML 默认值、
 * Telegram 数据库列映射都从这里派生，新增类型时不需要到处复制字段列表。
 */

export const PUSH_TYPE_DEFINITIONS = [
  {
    key: 'daily_summary_journal',
    label: '通过期刊总结',
    tagLabel: '通过期刊',
    tagClass: 'daily-summary',
    telegramKey: 'dailySummaryJournal',
    column: 'daily_summary_journal',
    defaultEnabled: true,
  },
  {
    key: 'daily_summary_blog_news',
    label: '通过资讯总结',
    tagLabel: '通过资讯',
    tagClass: 'daily-summary',
    telegramKey: 'dailySummaryBlogNews',
    column: 'daily_summary_blog_news',
    defaultEnabled: true,
  },
  {
    key: 'journal_all',
    label: '全部期刊总结（包含未通过的）',
    tagLabel: '全部期刊',
    tagClass: 'journal-all',
    telegramKey: 'journalAll',
    column: 'journal_all',
    defaultEnabled: true,
  },
  {
    key: 'new_articles',
    label: '新增文章',
    tagLabel: '新增文章',
    tagClass: 'new-articles',
    telegramKey: 'newArticles',
    column: 'new_articles',
    defaultEnabled: true,
  },
  {
    key: 'insights',
    label: '洞察报告（15天周期）',
    tagLabel: '洞察报告',
    tagClass: 'insights',
    telegramKey: 'insights',
    column: 'insights',
    defaultEnabled: true,
  },
  {
    key: 'pdf_summary',
    label: 'PDF 全文总结',
    tagLabel: 'PDF 总结',
    tagClass: 'pdf-summary',
    telegramKey: 'pdfSummary',
    column: 'pdf_summary',
    defaultEnabled: true,
  },
  {
    key: 'health_alert',
    label: '服务器健康告警',
    tagLabel: '健康告警',
    tagClass: 'health-alert',
    telegramKey: 'healthAlert',
    column: 'health_alert',
    // 系统告警默认不开启，由用户显式勾选，避免新增接收者被动收到运维告警
    defaultEnabled: false,
  },
] as const;

export type PushType = (typeof PUSH_TYPE_DEFINITIONS)[number]['key'];
export type PushTypeDefinition = (typeof PUSH_TYPE_DEFINITIONS)[number];
export type TelegramPushField = (typeof PUSH_TYPE_DEFINITIONS)[number]['telegramKey'];

const PUSH_TYPE_MAP = new Map<string, PushTypeDefinition>(
  PUSH_TYPE_DEFINITIONS.map((type) => [type.key, type])
);

/**
 * 推送类型中文标签
 */
export const PUSH_TYPE_LABELS: Record<PushType, string> = Object.fromEntries(
  PUSH_TYPE_DEFINITIONS.map((type) => [type.key, type.label])
) as Record<PushType, string>;

/**
 * 所有有效的推送类型数组（用于运行时验证）
 */
export const VALID_PUSH_TYPES: PushType[] = PUSH_TYPE_DEFINITIONS.map((type) => type.key);

/**
 * 旧的常量对象，保留以兼容既有引用
 */
export const PUSH_TYPES = {
  DAILY_SUMMARY_JOURNAL: 'daily_summary_journal',
  DAILY_SUMMARY_BLOG_NEWS: 'daily_summary_blog_news',
  JOURNAL_ALL: 'journal_all',
  NEW_ARTICLES: 'new_articles',
  INSIGHTS: 'insights',
  PDF_SUMMARY: 'pdf_summary',
  HEALTH_ALERT: 'health_alert',
} as const;

export function getPushType(key: PushType): PushTypeDefinition {
  const definition = PUSH_TYPE_MAP.get(key);
  if (!definition) {
    throw new Error(`Unknown push type: ${key}`);
  }
  return definition;
}
