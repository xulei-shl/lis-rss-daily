/**
 * Configuration management
 *
 * Centralized configuration with environment variable support.
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Config {
  // Server
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
    port: parseInt(process.env.PORT || '3000', 10),
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
    rssFetchSchedule: process.env.RSS_FETCH_SCHEDULE || '0 9 * * *',
    rssFetchEnabled: process.env.RSS_FETCH_ENABLED !== 'false',
    rssMaxConcurrent: parseInt(process.env.RSS_MAX_CONCURRENT || '5', 10),
    rssFetchTimeout: parseInt(process.env.RSS_FETCH_TIMEOUT || '30000', 10),
    rssFirstRunMaxArticles: parseInt(process.env.RSS_FIRST_RUN_MAX_ARTICLES || '50', 10),

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
    logFile: process.env.LOG_FILE,
    llmLogFile: process.env.LLM_LOG_FILE,
    llmLogFullPrompt: process.env.LLM_LOG_FULL_PROMPT === 'true',
    llmLogFullSampleRate: parseInt(process.env.LLM_LOG_FULL_SAMPLE_RATE || '20', 10),

    // LLM Rate Limiting
    llmRateLimitEnabled: process.env.LLM_RATE_LIMIT_ENABLED !== 'false',
    llmRateLimitRequestsPerMinute: parseInt(process.env.LLM_RATE_LIMIT_REQUESTS_PER_MINUTE || '60', 10),
    llmRateLimitBurstCapacity: parseInt(process.env.LLM_RATE_LIMIT_BURST_CAPACITY || '10', 10),
    llmRateLimitQueueTimeout: parseInt(process.env.LLM_RATE_LIMIT_QUEUE_TIMEOUT || '30000', 10),
  };
}

export const config = getConfig();
