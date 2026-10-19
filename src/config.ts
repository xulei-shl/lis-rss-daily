/**
 * Configuration management
 *
 * Centralized configuration with environment variable support.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { floatEnv, intEnv } from './utils/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  // Server
  host: string;
  port: number;
  baseUrl: string;

  // Database
  databasePath: string;

  // JWT
  jwtSecret: string;
  jwtExpiresIn: string;

  // LLM
  llmProvider: 'openai' | 'gemini';
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiDefaultModel: string;
  geminiApiKey?: string;
  geminiModel: string;
  llmEncryptionKey: string;

  // RSS
  rssFetchSchedule: string;
  rssFetchEnabled: boolean;
  rssMaxConcurrent: number;
  rssFetchTimeout: number;
  rssFirstRunMaxArticles: number;

  // Related Articles Refresh
  relatedRefreshEnabled: boolean;
  relatedRefreshSchedule: string;
  relatedRefreshBatchSize: number;
  relatedRefreshStaleDays: number;

  // Daily Summary
  dailySummaryEnabled: boolean;
  dailySummarySchedule: string;
  dailySummaryTypes: string[];

  // Insights
  insightsEnabled: boolean;
  insightsSchedule: string;
  insightsIntervalDays: number;
  insightsDays: number;
  insightsUserId: number;

  // Search AI Summary
  searchAiSummaryGuestEnabled: boolean;

  // Logging
  logLevel: string;
  logFile?: string;
  llmLogFile?: string;
  llmLogFullPrompt: boolean;
  llmLogFullSampleRate: number;

  // LLM Rate Limiting
  llmRateLimitEnabled: boolean;
  llmRateLimitRequestsPerMinute: number;
  llmRateLimitBurstCapacity: number;
  llmRateLimitQueueTimeout: number;

  // Staggered Delay (for auto-filter after RSS fetch)
  staggerDelayMaxMinutes: number;

  // Timezone
  defaultTimezone: string;

  // Telegram
  httpProxy?: string;

  // Journal Crawler
  journalCrawlEnabled: boolean;
  journalCrawlSchedule: string;
  journalInterval: number;
  journalIntervalRandom: number;
  spiderTimeout: number;

  // Keyword Crawler
  keywordCrawlEnabled: boolean;
  keywordCrawlSchedule: string;
  keywordInterval: number;
  keywordIntervalRandom: number;

  // Web Scraper Source
  webFetchEnabled: boolean;
  webFetchSchedule: string;

  // Gmail Email Source
  gmailFetchEnabled: boolean;
  gmailFetchSchedule: string;
  gmailMaxEmails: number;

  // Rejected Article Cleanup
  rejectedCleanupEnabled: boolean;
  rejectedCleanupSchedule: string;

  // Chroma
  chromaHost: string;
  chromaPort: number;

  // TypeSafe (JEV)
  typesafeApiKey?: string;
  jevRequestTimeoutMs: number;
  jevMaxRetries: number;

  // 语义检索 JEV 精排
  searchJevEnabled: boolean;
  searchJevBatch: number;
  searchJevMaxCandidates: number;
  searchJevWeight: number;

  // 我的每日评分
  myDailyEnabled: boolean;
  myDailySchedule: string;
  myDailyConcurrency: number;

  // DeepSearch
  deepSearchApiUrl: string;

  // Topic Cluster（主题聚类与多维分析）
  clusterEnabled: boolean;
  clusterSchedule: string;
  clusterUserId: number;
  clusterScope: 'journal_only' | 'all_summary';
  clusterSimThreshold: number;
  clusterInitThreshold: number;
  clusterReclaimThreshold: number;
  clusterAngleThreshold: number;
  clusterChainThreshold: number;
  clusterStrongThreshold: number;
  clusterMinPoolSize: number;
  clusterMinClusterSize: number;
  clusterMaxTopicsPerArticle: number;
  clusterMinTrendSamples: number;
  clusterDormantDays: number;
  clusterLlmConcurrency: number;
  clusterEmbeddingDim: number;
  clusterFacetContractVersion: string;
}

function getConfig(): Config {
  // LLM Encryption Key with security warning
  const llmEncryptionKey = process.env.LLM_ENCRYPTION_KEY || '0000000000000000000000000000000000000000000000000000000000000000';
  const DEFAULT_ENCRYPTION_KEY = '0000000000000000000000000000000000000000000000000000000000000000';

  if (llmEncryptionKey === DEFAULT_ENCRYPTION_KEY) {
    console.warn('⚠️  警告: 使用默认的 LLM 加密密钥。生产环境请设置 LLM_ENCRYPTION_KEY 环境变量。');
  }

  // JWT Secret with security warning
  const jwtSecret = process.env.JWT_SECRET || 'change-this-secret-in-production';
  if (jwtSecret === 'change-this-secret-in-production') {
    console.warn('⚠️  警告: 使用默认的 JWT 密钥。生产环境请设置 JWT_SECRET 环境变量。');
  }

  return {
    // Server
    host: process.env.HOST || '0.0.0.0',
    port: intEnv(process.env.PORT, 3000, 1),
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',

    // Database
    databasePath: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'rss-tracker.db'),

    // JWT
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

    // LLM
    llmProvider: (process.env.LLM_PROVIDER as 'openai' | 'gemini') || 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiDefaultModel: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini',
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    llmEncryptionKey,

    // RSS
    rssFetchSchedule: process.env.RSS_FETCH_SCHEDULE || '0 2 * * *',
    rssFetchEnabled: process.env.RSS_FETCH_ENABLED !== 'false',
    rssMaxConcurrent: intEnv(process.env.RSS_MAX_CONCURRENT, 5, 1),
    rssFetchTimeout: intEnv(process.env.RSS_FETCH_TIMEOUT, 30000, 1),
    rssFirstRunMaxArticles: intEnv(process.env.RSS_FIRST_RUN_MAX_ARTICLES, 50, 0),

    // Related Articles Refresh
    relatedRefreshEnabled: process.env.RELATED_REFRESH_ENABLED !== 'false',
    relatedRefreshSchedule: process.env.RELATED_REFRESH_SCHEDULE || '0 2 * * *',
    relatedRefreshBatchSize: intEnv(process.env.RELATED_REFRESH_BATCH_SIZE, 100, 1),
    relatedRefreshStaleDays: intEnv(process.env.RELATED_REFRESH_STALE_DAYS, 7, 0),

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
    logFile: process.env.LOG_FILE,
    llmLogFile: process.env.LLM_LOG_FILE,
    llmLogFullPrompt: process.env.LLM_LOG_FULL_PROMPT === 'true',
    llmLogFullSampleRate: intEnv(process.env.LLM_LOG_FULL_SAMPLE_RATE, 20, 0),

    // LLM Rate Limiting
    llmRateLimitEnabled: process.env.LLM_RATE_LIMIT_ENABLED !== 'false',
    llmRateLimitRequestsPerMinute: intEnv(process.env.LLM_RATE_LIMIT_REQUESTS_PER_MINUTE, 60, 1),
    llmRateLimitBurstCapacity: intEnv(process.env.LLM_RATE_LIMIT_BURST_CAPACITY, 10, 1),
    llmRateLimitQueueTimeout: intEnv(process.env.LLM_RATE_LIMIT_QUEUE_TIMEOUT, 30000, 0),

    // Staggered Delay (for auto-filter after RSS fetch)
    staggerDelayMaxMinutes: intEnv(process.env.STAGGER_DELAY_MAX_MINUTES, 30, 0),

    // Timezone
    defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Shanghai',

    // Telegram
    httpProxy: process.env.HTTP_PROXY,

    // Journal Crawler
    journalCrawlEnabled: process.env.JOURNAL_CRAWL_ENABLED !== 'false',
    journalCrawlSchedule: process.env.JOURNAL_CRAWL_SCHEDULE || '15 2 * * 6',
    journalInterval: intEnv(process.env.JOURNAL_INTERVAL, 480000, 1),
    journalIntervalRandom: intEnv(process.env.JOURNAL_INTERVAL_RANDOM, 0, 0),
    spiderTimeout: intEnv(process.env.SPIDER_TIMEOUT, 430000, 1),

    // Keyword Crawler
    keywordCrawlEnabled: process.env.KEYWORD_CRAWL_ENABLED !== 'false',
    keywordCrawlSchedule: process.env.KEYWORD_CRAWL_SCHEDULE || '15 3 * * 6',
    keywordInterval: intEnv(process.env.KEYWORD_INTERVAL, 300000, 1),
    keywordIntervalRandom: intEnv(process.env.KEYWORD_INTERVAL_RANDOM, 30000, 0),

    // Daily Summary
    dailySummaryEnabled: process.env.DAILY_SUMMARY_ENABLED !== 'false',
    dailySummarySchedule: process.env.DAILY_SUMMARY_SCHEDULE || '0 7 * * *',
    dailySummaryTypes: (process.env.DAILY_SUMMARY_TYPES || 'journal,blog_news,journal_all').split(','),

    // Insights
    insightsEnabled: process.env.INSIGHTS_ENABLED !== 'false',
    insightsSchedule: process.env.INSIGHTS_SCHEDULE || '15 7 * * *',
    insightsIntervalDays: intEnv(process.env.INSIGHTS_INTERVAL_DAYS, 10, 1),
    insightsDays: intEnv(process.env.INSIGHTS_DAYS, 10, 1),
    insightsUserId: intEnv(process.env.INSIGHTS_USER_ID, 1, 1),

    // Search AI Summary
    searchAiSummaryGuestEnabled: process.env.SEARCH_AI_SUMMARY_GUEST_ENABLED === 'true',

    // Web Scraper Source
    webFetchEnabled: process.env.WEB_FETCH_ENABLED !== 'false',
    webFetchSchedule: process.env.WEB_FETCH_SCHEDULE || '0 3 * * *',

    // Gmail Email Source
    gmailFetchEnabled: process.env.GMAIL_FETCH_ENABLED !== 'false',
    gmailFetchSchedule: process.env.GMAIL_FETCH_SCHEDULE || '0 4 * * *',
    gmailMaxEmails: intEnv(process.env.GMAIL_MAX_EMAILS, 20, 1),


    // Rejected Article Cleanup
    rejectedCleanupEnabled: process.env.REJECTED_CLEANUP_ENABLED !== 'false',
    rejectedCleanupSchedule: process.env.REJECTED_CLEANUP_SCHEDULE || '0 8 * * *',

    // Chroma
    chromaHost: process.env.CHROMA_HOST || '127.0.0.1',
    chromaPort: intEnv(process.env.CHROMA_PORT, 8000, 1),

    // TypeSafe (JEV)
    typesafeApiKey: process.env.TYPESAFE_API_KEY,
    jevRequestTimeoutMs: intEnv(process.env.JEV_REQUEST_TIMEOUT_MS, 30000, 1),
    jevMaxRetries: intEnv(process.env.JEV_MAX_RETRIES, 2, 0),

    // 语义检索 JEV 精排
    searchJevEnabled: process.env.SEARCH_JEV_ENABLED !== 'false',
    searchJevBatch: intEnv(process.env.SEARCH_JEV_BATCH, 20, 1),
    searchJevMaxCandidates: intEnv(process.env.SEARCH_JEV_MAX_CANDIDATES, 50, 1),
    searchJevWeight: floatEnv(process.env.SEARCH_JEV_WEIGHT, 1, 0),

    // 我的每日评分
    myDailyEnabled: process.env.MY_DAILY_ENABLED !== 'false',
    myDailySchedule: process.env.MY_DAILY_SCHEDULE || '30 7 * * *',
    myDailyConcurrency: intEnv(process.env.MY_DAILY_CONCURRENCY, 5, 1),

    // DeepSearch
    deepSearchApiUrl: process.env.DEEPSEARCH_API_URL || 'http://localhost:8082',

    // Topic Cluster（默认值均为初始值，需按设计文档 §14.3 校准后固化）
    clusterEnabled: process.env.CLUSTER_ENABLED !== 'false',
    clusterSchedule: process.env.CLUSTER_SCHEDULE || '30 8 * * *',
    clusterUserId: intEnv(process.env.CLUSTER_USER_ID, 1, 1),
    clusterScope: process.env.CLUSTER_SCOPE === 'journal_only' ? 'journal_only' : 'all_summary',
    clusterSimThreshold: floatEnv(process.env.CLUSTER_SIM_THRESHOLD, 0.78, 0),
    // 冷启动/孵化：平均连接凝聚的**簇间平均相似度**阈值。
    // 注意尺度与单链不同（平均连接恒 ≤ 单链），且实测本语料两两相似度上界在 0.75 附近，
    // 因此旧值 0.80 在新算法下**结构性不可达**（一簇都孵不出）。
    // 当前 0.65 为待校准的临时值，必须以 pnpm run cluster:validate 在 200+ 篇切面上实测后定稿。
    clusterInitThreshold: floatEnv(process.env.CLUSTER_INIT_THRESHOLD, 0.65, 0),
    clusterReclaimThreshold: floatEnv(process.env.CLUSTER_RECLAIM_THRESHOLD, 0.8, 0),
    clusterAngleThreshold: floatEnv(process.env.CLUSTER_ANGLE_THRESHOLD, 0.82, 0),
    clusterChainThreshold: floatEnv(process.env.CLUSTER_CHAIN_THRESHOLD, 0.78, 0),
    clusterStrongThreshold: floatEnv(process.env.CLUSTER_STRONG_THRESHOLD, 0.88, 0),
    clusterMinPoolSize: intEnv(process.env.CLUSTER_MIN_POOL_SIZE, 6, 1),
    clusterMinClusterSize: intEnv(process.env.CLUSTER_MIN_CLUSTER_SIZE, 3, 2),
    clusterMaxTopicsPerArticle: intEnv(process.env.CLUSTER_MAX_TOPICS_PER_ARTICLE, 2, 1),
    clusterMinTrendSamples: intEnv(process.env.CLUSTER_MIN_TREND_SAMPLES, 6, 2),
    clusterDormantDays: intEnv(process.env.CLUSTER_DORMANT_DAYS, 60, 1),
    clusterLlmConcurrency: intEnv(process.env.CLUSTER_LLM_CONCURRENCY, 2, 1),
    clusterEmbeddingDim: intEnv(process.env.CLUSTER_EMBEDDING_DIM, 1024, 1),
    // v2：方法/研究对象改为封闭词表（见 topic-cluster/domain/vocab.ts），
    // 契约变更后 v1 切面自动回到「待抽取」，无需手工清库（设计文档 §7.9）
    clusterFacetContractVersion: process.env.CLUSTER_FACET_CONTRACT_VERSION || 'v2',
  };
}

export const config = getConfig();
