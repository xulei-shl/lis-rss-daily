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

  // Logging
  logLevel: string;
  logFile?: string;
}

function getConfig(): Config {
  return {
    // Server
    port: parseInt(process.env.PORT || '3000', 10),
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',

    // Database
    databasePath: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'rss-tracker.db'),

    // JWT
    jwtSecret: process.env.JWT_SECRET || 'change-this-secret-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

    // LLM
    llmProvider: (process.env.LLM_PROVIDER as 'openai' | 'gemini') || 'openai',
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiDefaultModel: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o-mini',
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    llmEncryptionKey: process.env.LLM_ENCRYPTION_KEY || '0000000000000000000000000000000000000000000000000000000000000000',

    // RSS
    rssFetchSchedule: process.env.RSS_FETCH_SCHEDULE || '0 9 * * *',
    rssFetchEnabled: process.env.RSS_FETCH_ENABLED !== 'false',
    rssMaxConcurrent: parseInt(process.env.RSS_MAX_CONCURRENT || '5', 10),
    rssFetchTimeout: parseInt(process.env.RSS_FETCH_TIMEOUT || '30000', 10),

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
    logFile: process.env.LOG_FILE,
  };
}

export const config = getConfig();
