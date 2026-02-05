/**
 * LLM Configs Service
 *
 * Database operations for LLM configuration management.
 * Supports multiple LLM configurations per user with encryption for API keys.
 */

import { getDb, type LlmConfigsTable } from '../db.js';
import { logger } from '../logger.js';
import { encryptAPIKey, decryptAPIKey } from '../utils/crypto.js';
import { config } from '../config.js';

const log = logger.child({ module: 'llm-configs-service' });

// Export types
export type LLMConfigRecord = LlmConfigsTable;

export interface CreateLLMConfigInput {
  provider: 'openai' | 'gemini' | 'custom';
  baseURL: string;
  apiKey: string;
  model: string;
  isDefault?: boolean;
  timeout?: number;
  maxRetries?: number;
  maxConcurrent?: number;
}

export interface UpdateLLMConfigInput {
  provider?: 'openai' | 'gemini' | 'custom';
  baseURL?: string;
  apiKey?: string;
  model?: string;
  isDefault?: boolean;
  timeout?: number;
  maxRetries?: number;
  maxConcurrent?: number;
}

export interface QueryOptions {
  page?: number;
  limit?: number;
  provider?: string;
}

export interface PaginatedResult<T> {
  configs: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateResult {
  id: number;
  provider: string;
  model: string;
}

// Exclude API key from returned records
type SafeLLMConfigRecord = Omit<LlmConfigsTable, 'api_key_encrypted'> & {
  has_api_key: boolean;
};

/**
 * Convert database record to safe record (without API key)
 */
function toSafeRecord(record: LlmConfigsTable): SafeLLMConfigRecord {
  const { api_key_encrypted, ...rest } = record;
  return {
    ...rest,
    has_api_key: !!api_key_encrypted,
  };
}

/**
 * Get user's LLM configurations (paginated)
 */
export async function getUserLLMConfigs(
  userId: number,
  options: QueryOptions = {}
): Promise<PaginatedResult<SafeLLMConfigRecord>> {
  const db = getDb();
  const page = options.page ?? 1;
  const limit = options.limit ?? 20;
  const offset = (page - 1) * limit;

  let query = db
    .selectFrom('llm_configs')
    .where('user_id', '=', userId);

  if (options.provider) {
    query = query.where('provider', '=', options.provider);
  }

  // Get total count
  const totalCountResult = await query
    .select((eb) => eb.fn.count('id').as('count'))
    .executeTakeFirst();

  const total = Number(totalCountResult?.count ?? 0);

  // Get paginated results
  const configs = await query
    .selectAll()
    .orderBy('is_default', 'desc')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();

  return {
    configs: configs.map(toSafeRecord),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get LLM config by ID
 */
export async function getLLMConfigById(
  id: number,
  userId: number
): Promise<LLMConfigRecord | undefined> {
  const db = getDb();

  const config = await db
    .selectFrom('llm_configs')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();

  return config;
}

/**
 * Get safe LLM config by ID (without API key)
 */
export async function getSafeLLMConfigById(
  id: number,
  userId: number
): Promise<SafeLLMConfigRecord | undefined> {
  const config = await getLLMConfigById(id, userId);
  return config ? toSafeRecord(config) : undefined;
}

/**
 * Get default LLM config for a user
 */
export async function getDefaultLLMConfig(
  userId: number
): Promise<LLMConfigRecord | undefined> {
  const db = getDb();

  const config = await db
    .selectFrom('llm_configs')
    .where('user_id', '=', userId)
    .where('is_default', '=', 1)
    .selectAll()
    .executeTakeFirst();

  return config;
}

/**
 * Create a new LLM configuration
 */
export async function createLLMConfig(
  userId: number,
  data: CreateLLMConfigInput
): Promise<CreateResult> {
  const db = getDb();

  // Encrypt API key
  const encryptedKey = encryptAPIKey(data.apiKey, config.llmEncryptionKey);

  // If this is set as default, unset other defaults
  if (data.isDefault) {
    await db
      .updateTable('llm_configs')
      .set({ is_default: 0, updated_at: new Date().toISOString() })
      .where('user_id', '=', userId)
      .where('is_default', '=', 1)
      .execute();
  }

  const result = await db
    .insertInto('llm_configs')
    .values({
      user_id: userId,
      provider: data.provider,
      base_url: data.baseURL,
      api_key_encrypted: encryptedKey,
      model: data.model,
      is_default: data.isDefault ? 1 : 0,
      timeout: data.timeout ?? 30000,
      max_retries: data.maxRetries ?? 3,
      max_concurrent: data.maxConcurrent ?? 5,
      updated_at: new Date().toISOString(),
    })
    .executeTakeFirstOrThrow();

  const insertedId = Number(result.insertId);

  log.info({ userId, llmConfigId: insertedId, provider: data.provider, model: data.model }, 'LLM config created');

  return {
    id: insertedId,
    provider: data.provider,
    model: data.model,
  };
}

/**
 * Update LLM configuration
 */
export async function updateLLMConfig(
  id: number,
  userId: number,
  data: UpdateLLMConfigInput
): Promise<void> {
  const db = getDb();

  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (data.provider !== undefined) {
    updateData.provider = data.provider;
  }

  if (data.baseURL !== undefined) {
    updateData.base_url = data.baseURL;
  }

  if (data.apiKey !== undefined) {
    updateData.api_key_encrypted = encryptAPIKey(data.apiKey, config.llmEncryptionKey);
  }

  if (data.model !== undefined) {
    updateData.model = data.model;
  }

  if (data.isDefault !== undefined) {
    // If setting as default, unset other defaults first
    if (data.isDefault) {
      await db
        .updateTable('llm_configs')
        .set({ is_default: 0, updated_at: new Date().toISOString() })
        .where('user_id', '=', userId)
        .where('id', '!=', id)
        .execute();
    }
    updateData.is_default = data.isDefault ? 1 : 0;
  }

  if (data.timeout !== undefined) {
    updateData.timeout = data.timeout;
  }

  if (data.maxRetries !== undefined) {
    updateData.max_retries = data.maxRetries;
  }

  if (data.maxConcurrent !== undefined) {
    updateData.max_concurrent = data.maxConcurrent;
  }

  const result = await db
    .updateTable('llm_configs')
    .set(updateData)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (result.numUpdatedRows === 0) {
    throw new Error('LLM config not found');
  }

  log.info({ userId, llmConfigId: id }, 'LLM config updated');
}

/**
 * Delete LLM configuration
 */
export async function deleteLLMConfig(id: number, userId: number): Promise<void> {
  const db = getDb();

  const result = await db
    .deleteFrom('llm_configs')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (result.numDeletedRows === 0) {
    throw new Error('LLM config not found');
  }

  log.info({ userId, llmConfigId: id }, 'LLM config deleted');
}

/**
 * Set LLM config as default
 */
export async function setDefaultLLMConfig(id: number, userId: number): Promise<void> {
  const db = getDb();

  // First, verify the config exists and belongs to the user
  const config = await getLLMConfigById(id, userId);
  if (!config) {
    throw new Error('LLM config not found');
  }

  // Unset all other defaults for this user
  await db
    .updateTable('llm_configs')
    .set({ is_default: 0, updated_at: new Date().toISOString() })
    .where('user_id', '=', userId)
    .where('id', '!=', id)
    .execute();

  // Set this one as default
  await db
    .updateTable('llm_configs')
    .set({ is_default: 1, updated_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute();

  log.info({ userId, llmConfigId: id }, 'LLM config set as default');
}

/**
 * Get decrypted API key for a config
 */
export async function getDecryptedAPIKey(id: number, userId: number): Promise<string> {
  const dbConfig = await getLLMConfigById(id, userId);
  if (!dbConfig) {
    throw new Error('LLM config not found');
  }

  return decryptAPIKey(dbConfig.api_key_encrypted, config.llmEncryptionKey);
}

/**
 * Test LLM connection
 */
export async function testLLMConnection(
  id: number,
  userId: number
): Promise<{ success: boolean; error?: string }> {
  try {
    const dbConfig = await getLLMConfigById(id, userId);
    if (!dbConfig) {
      return { success: false, error: 'LLM config not found' };
    }

    const apiKey = decryptAPIKey(dbConfig.api_key_encrypted, config.llmEncryptionKey);

    // Simple connection test based on provider
    if (dbConfig.provider === 'openai' || dbConfig.provider === 'custom') {
      // Test with OpenAI-compatible chat completions endpoint
      // This is more universally supported than /models
      const response = await fetch(`${dbConfig.base_url}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: dbConfig.model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 10,
        }),
        signal: AbortSignal.timeout(15000), // 15 second timeout
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 100)}` : ''}`
        };
      }
    } else if (dbConfig.provider === 'gemini') {
      // Test Gemini endpoint
      const url = `${dbConfig.base_url}/${dbConfig.model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'test' }] }],
          generationConfig: { maxOutputTokens: 1 },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
      }
    }

    return { success: true };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { success: false, error: 'Connection timeout' };
      }
      return { success: false, error: error.message };
    }
    return { success: false, error: 'Unknown error' };
  }
}

/**
 * Get active LLM config for use (default or first available)
 */
export async function getActiveLLMConfig(userId: number): Promise<LLMConfigRecord | null> {
  // Try default first
  const defaultConfig = await getDefaultLLMConfig(userId);
  if (defaultConfig) {
    return defaultConfig;
  }

  // Fall back to first available config
  const db = getDb();
  const config = await db
    .selectFrom('llm_configs')
    .where('user_id', '=', userId)
    .selectAll()
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();

  return config ?? null;
}
