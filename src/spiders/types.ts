/**
 * Spider module type definitions
 * 期刊爬虫模块类型定义
 */

/**
 * 期刊来源类型
 */
export type JournalSourceType = 'cnki' | 'rdfybk' | 'lis' | 'wanfang';

/**
 * 发行周期
 */
export type PublicationCycle = 'monthly' | 'bimonthly' | 'semimonthly' | 'quarterly';

/**
 * 爬虫运行参数
 */
export interface SpiderRunParams {
  url?: string;       // CNKI 期刊 URL
  code?: string;      // 人大报刊期刊代码
  journalName?: string; // 期刊名称（用于 CNKI 搜索）
  year: number;       // 年份
  issue: number;      // 期号
  volume?: number;    // 卷号（LIS 期刊使用）
}

/**
 * 爬取的文章数据（从 Python 爬虫返回）
 */
export interface CrawledArticle {
  title: string;
  url: string;
  author?: string;
  abstract?: string;
  keywords?: string[];
  publishedYear: number;
  publishedIssue: number;
  publishedVolume?: number;
  pages?: string;
  doi?: string;
}

/**
 * 爬虫运行结果
 */
export interface SpiderResult {
  success: boolean;
  articles: CrawledArticle[];
  error?: string;
}

/**
 * 爬虫配置
 */
export interface SpiderConfig {
  journalInterval: number;        // 期刊间隔（毫秒）
  journalIntervalRandom: number;  // 随机化范围（毫秒）
  requestDelay: number;           // 请求间隔（毫秒）
  requestDelayRandom: number;     // 请求随机化范围（毫秒）
  timeout: number;                // 超时时间（毫秒）
  maxRetries: number;             // 最大重试次数
}

/**
 * 默认爬虫配置
 */
export const DEFAULT_SPIDER_CONFIG: SpiderConfig = {
  journalInterval: 180000,        // 期刊间隔 3 分钟
  journalIntervalRandom: 30000,   // 随机化范围 ±30 秒
  requestDelay: 5000,             // 请求间隔 5 秒
  requestDelayRandom: 2000,       // 随机化范围 ±2 秒
  timeout: 300000,                // 超时时间 5 分钟
  maxRetries: 3,                  // 最大重试次数
};

/**
 * 期刊信息（用于爬取）
 */
export interface JournalInfo {
  id: number;
  name: string;
  source_type: JournalSourceType;
  source_url: string | null;
  journal_code: string | null;
  publication_cycle: PublicationCycle;
  issues_per_year: number;
  volume_offset: number;
  last_year: number | null;
  last_issue: number | null;
  last_volume: number | null;
}

/**
 * 爬取任务
 */
export interface CrawlTask {
  journal: JournalInfo;
  year: number;
  issue: number;
  volume?: number;
}

/**
 * 爬取结果（包含日志信息）
 */
export interface CrawlResult {
  success: boolean;
  journalId: number;
  year: number;
  issue: number;
  volume?: number;
  articlesCount: number;
  newArticlesCount: number;
  durationMs: number;
  error?: string;
}
