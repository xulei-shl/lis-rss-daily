/**
 * LLM Configs Service
 *
 * Database operations for LLM configuration management.
 * Supports multiple LLM configurations per user with encryption for API keys.
 */

import { getDb, type LlmConfigsTable, type DatabaseTable } from '../db.js';
import { logger } from '../logger.js';
import { encryptAPIKey, decryptAPIKey } from '../utils/crypto.js';
import { config } from '../config.js';
import { TASK_TYPES, type TaskType } from '../config/system-prompt-variables.js';

const log = logger.child({ module: 'llm-configs-service' });

// Export types
export type LLMConfigRecord = LlmConfigsTable;

export interface CreateLLMConfigInput {
  provider: 'openai' | 'gemini' | 'custom';
  baseURL: string;
  apiKey: string;
  model: string;
  configType?: 'llm' | 'embedding' | 'rerank';
  taskType?: TaskType;
  enabled?: boolean;
  isDefault?: boolean;
  priority?: number;
  timeout?: number;
  maxRetries?: number;
  maxConcurrent?: number;
}

export interface UpdateLLMConfigInput {
  provider?: 'openai' | 'gemini' | 'custom';
  baseURL?: string;
  apiKey?: string;
  model?: string;
  configType?: 'llm' | 'embedding' | 'rerank';
  taskType?: TaskType;
  enabled?: boolean;
  isDefault?: boolean;
  priority?: number;
  timeout?: number;
  maxRetries?: number;
  maxConcurrent?: number;
}

export interface QueryOptions {
  page?: number;
  limit?: number;
  provider?: string;
  configType?: 'llm' | 'embedding' | 'rerank';
  taskType?: TaskType;
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
  if (options.configType) {
    query = query.where('config_type', '=', options.configType);
  }
  if (options.taskType) {
    query = query.where('task_type', '=', options.taskType);
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
    .orderBy('priority', 'asc')
    .orderBy('created_at', 'asc')
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
  return getDefaultConfigByType(userId, 'llm');
}

/**
 * 获取指定类型的默认配置
 */
export async function getDefaultConfigByType(
  userId: number,
  configType: 'llm' | 'embedding' | 'rerank'
): Promise<LLMConfigRecord | undefined> {
  const db = getDb();

  const config = await db
    .selectFrom('llm_configs')
    .where('user_id', '=', userId)
    .where('config_type', '=', configType)
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
  const configType = data.configType ?? 'llm';
  const enabled = data.enabled ?? false;

  // 约束验证：taskType 和 isDefault 互斥
  if (data.taskType && data.isDefault) {
    throw new Error('有任务类型的配置不能设置为默认配置。只有通用配置（task_type 为空）才能设置为默认。');
  }

  // Encrypt API key
  const encryptedKey = encryptAPIKey(data.apiKey, config.llmEncryptionKey);

  // If this is set as default, unset other defaults
  if (data.isDefault) {
    await db
      .updateTable('llm_configs')
      .set({ is_default: 0, updated_at: new Date().toISOString() })
      .where('user_id', '=', userId)
      .where('config_type', '=', configType)
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
      config_type: configType,
      task_type: data.taskType ?? null,
      enabled: enabled ? 1 : 0,
      is_default: data.isDefault ? 1 : 0,
      priority: data.priority ?? 100,
      timeout: data.timeout ?? 30000,
      max_retries: data.maxRetries ?? 3,
      max_concurrent: data.maxConcurrent ?? 5,
      updated_at: new Date().toISOString(),
    } as any)
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
  const existing = await getLLMConfigById(id, userId);
  if (!existing) {
    throw new Error('LLM config not found');
  }

  // 约束验证：taskType 和 isDefault 互斥
  const newTaskType = data.taskType ?? existing.task_type;
  const newIsDefault = data.isDefault ?? (existing.is_default === 1);
  if (newTaskType && newIsDefault) {
    throw new Error('有任务类型的配置不能设置为默认配置。只有通用配置（task_type 为空）才能设置为默认。');
  }

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

  if (data.configType !== undefined) {
    updateData.config_type = data.configType;
  }

  if (data.taskType !== undefined) {
    updateData.task_type = data.taskType;
  }

  if (data.enabled !== undefined) {
    updateData.enabled = data.enabled ? 1 : 0;
  }

  if (data.isDefault !== undefined) {
    // If setting as default, unset other defaults first
    if (data.isDefault) {
      await db
        .updateTable('llm_configs')
        .set({ is_default: 0, updated_at: new Date().toISOString() })
        .where('user_id', '=', userId)
        .where('config_type', '=', (data.configType ?? existing.config_type) as string)
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

  if (data.priority !== undefined) {
    updateData.priority = data.priority;
  }

  const result = await db
    .updateTable('llm_configs')
    .set(updateData)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (result.numUpdatedRows === 0n) {
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

  if (result.numDeletedRows === 0n) {
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
    .where('config_type', '=', config.config_type)
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

    const configType = (dbConfig.config_type || 'llm') as 'llm' | 'embedding' | 'rerank';

    if (configType === 'embedding') {
      const response = await fetch(`${dbConfig.base_url}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: dbConfig.model,
          input: ['test'],
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 100)}` : ''}`,
        };
      }
    } else if (configType === 'rerank') {
      const response = await fetch(`${dbConfig.base_url}/rerank`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: dbConfig.model,
          query: 'test',
          documents: ['a', 'b'],
          top_n: 2,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 100)}` : ''}`,
        };
      }
    } else if (dbConfig.provider === 'openai' || dbConfig.provider === 'custom') {
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
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 100)}` : ''}`,
        };
      }
    } else if (dbConfig.provider === 'gemini') {
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
  return getActiveConfigByType(userId, 'llm');
}

/**
 * 获取指定类型的活跃配置（默认优先）
 */
export async function getActiveConfigByType(
  userId: number,
  configType: 'llm' | 'embedding' | 'rerank'
): Promise<LLMConfigRecord | null> {
  const db = getDb();
  const config = await db
    .selectFrom('llm_configs')
    .where('user_id', '=', userId)
    .where('config_type', '=', configType)
    .where('enabled', '=', 1)
    .selectAll()
    .orderBy('is_default', 'desc')
    .orderBy('priority', 'asc')
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst();

  return config ?? null;
}

/**
 * 获取指定类型的活跃配置列表（默认优先 + 优先级排序）
 */
export async function getActiveConfigListByType(
  userId: number,
  configType: 'llm' | 'embedding' | 'rerank'
): Promise<LLMConfigRecord[]> {
  const db = getDb();
  const configs = await db
    .selectFrom('llm_configs')
    .where('user_id', '=', userId)
    .where('config_type', '=', configType)
    .where('enabled', '=', 1)
    .selectAll()
    .orderBy('is_default', 'desc')
    .orderBy('priority', 'asc')
    .orderBy('created_at', 'asc')
    .execute();

  return configs;
}

/**
 * 获取指定类型和任务类型的活跃配置（单条）
 * 优先级：精确匹配 task_type > task_type 为空（兜底）
 */
export async function getActiveConfigByTypeAndTask(
  userId: number,
  configType: 'llm' | 'embedding' | 'rerank',
  taskType?: string
): Promise<LLMConfigRecord | null> {
  // 复用列表查询函数，取第一条
  const configs = await getActiveConfigListByTypeAndTask(userId, configType, taskType);
  return configs[0] ?? null;
}

/**
 * 获取指定类型和任务类型的活跃配置列表（支持故障转移）
 * 优先级：精确匹配 task_type > task_type 为空（兜底配置）
 */
export async function getActiveConfigListByTypeAndTask(
  userId: number,
  configType: 'llm' | 'embedding' | 'rerank',
  taskType?: string
): Promise<LLMConfigRecord[]> {
  const db = getDb();

  // 查询所有匹配的配置（task_type 精确匹配或为空）
  const configs = await db
    .selectFrom('llm_configs')
    .where('user_id', '=', userId)
    .where('config_type', '=', configType)
    .where('enabled', '=', 1)
    .where((eb) =>
      eb.or([
        eb('task_type', '=', taskType ?? null),
        eb('task_type', 'is', null),
      ])
    )
    .selectAll()
    .execute();

  // 在应用层排序：精确匹配 task_type 优先，然后是 task_type 为空的兜底配置
  return configs.sort((a, b) => {
    // 优先级 1: task_type 精确匹配
    const aExactMatch = a.task_type === (taskType ?? null) ? 1 : 0;
    const bExactMatch = b.task_type === (taskType ?? null) ? 1 : 0;
    if (aExactMatch !== bExactMatch) {
      return bExactMatch - aExactMatch; // 精确匹配优先
    }

    // 优先级 2: is_default（默认配置优先）
    if (a.is_default !== b.is_default) {
      return (b.is_default ?? 0) - (a.is_default ?? 0);
    }

    // 优先级 3: priority（数字越小越优先）
    if ((a.priority ?? 100) !== (b.priority ?? 100)) {
      return (a.priority ?? 100) - (b.priority ?? 100);
    }

    // 优先级 4: created_at（最早创建的优先）
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}
