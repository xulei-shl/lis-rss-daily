/**
 * 系统提示词服务
 *
 * 负责 system_prompts 表的 CRUD 操作。
 */

import { getDb, type SystemPromptsTable, type DatabaseTable } from '../db.js';
import { logger } from '../logger.js';
import { variablesToJSON, getVariableDefinitions, PROMPT_VARIABLES } from '../config/system-prompt-variables.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = logger.child({ module: 'system-prompts-service' });

export type SystemPromptRecord = SystemPromptsTable;

export interface CreateSystemPromptInput {
  type: string;
  name: string;
  template: string;
  variables?: string | Record<string, unknown> | null;
  isActive?: boolean;
}

export interface UpdateSystemPromptInput {
  type?: string;
  name?: string;
  template?: string;
  variables?: string | Record<string, unknown> | null;
  isActive?: boolean;
}

export interface QueryOptions {
  type?: string;
  isActive?: boolean;
}

/**
 * 默认提示词配置
 * 每种类型对应一个 md 文件，如果文件不存在则不创建该类型的默认提示词
 */
const DEFAULT_PROMPT_CONFIG: Record<
  string,
  { fileName: string; name: string }
> = {
  filter: { fileName: 'filter.md', name: '默认文章过滤提示词' },
  summary: { fileName: 'summary.md', name: '默认摘要提示词' },
  keywords: { fileName: 'keywords.md', name: '默认关键词提示词' },
  translation: { fileName: 'translation.md', name: '默认翻译提示词' },
  daily_summary: { fileName: 'daily_summary.md', name: '默认当日总结提示词' },
};

/**
 * 默认提示词模板目录
 */
const DEFAULT_PROMPTS_DIR = path.join(__dirname, '../config/default-prompts');

/**
 * 从 md 文件读取默认提示词模板
 */
function readDefaultPromptTemplate(type: string): string | null {
  const config = DEFAULT_PROMPT_CONFIG[type];
  if (!config) {
    return null;
  }

  const filePath = path.join(DEFAULT_PROMPTS_DIR, config.fileName);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    // 文件不存在，跳过该类型的默认提示词
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function renderSystemPrompt(
  template: string,
  variables: Record<string, string>
): string {
  if (!template) return template;
  let output = template;
  for (const [key, value] of Object.entries(variables)) {
    if (value === undefined || value === null) continue;
    const pattern = new RegExp(`{{\\s*${escapeRegExp(key)}\\s*}}`, 'g');
    output = output.replace(pattern, String(value));
  }
  return output;
}

function normalizeVariables(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    JSON.parse(trimmed);
    return trimmed;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  throw new Error('variables 必须是 JSON 字符串或对象');
}

export async function getActiveSystemPromptByType(
  userId: number,
  type: string
): Promise<SystemPromptRecord | undefined> {
  const db = getDb();
  return db
    .selectFrom('system_prompts')
    .where('user_id', '=', userId)
    .where('type', '=', type)
    .where('is_active', '=', 1)
    .selectAll()
    .orderBy('updated_at', 'desc')
    .executeTakeFirst();
}

export async function resolveSystemPrompt(
  userId: number | undefined,
  type: string,
  fallback: string,
  variables: Record<string, string>
): Promise<string> {
  if (!userId) return fallback;
  const record = await getActiveSystemPromptByType(userId, type);
  if (!record || !record.template || record.template.trim().length === 0) {
    return fallback;
  }
  return renderSystemPrompt(record.template, variables);
}

export async function ensureDefaultSystemPrompts(
  userId: number
): Promise<{ created: number; skipped: number }> {
  const db = getDb();
  let created = 0;
  let skipped = 0;

  for (const [type, config] of Object.entries(DEFAULT_PROMPT_CONFIG)) {
    // 检查是否已存在该类型的提示词
    const existing = await db
      .selectFrom('system_prompts')
      .where('user_id', '=', userId)
      .where('type', '=', type)
      .select(['id'])
      .executeTakeFirst();

    if (existing) {
      skipped += 1;
      continue;
    }

    // 从 md 文件读取模板内容
    const template = readDefaultPromptTemplate(type);
    if (!template) {
      // md 文件不存在，跳过
      log.debug({ type, fileName: config.fileName }, 'Default prompt template file not found, skipping');
      skipped += 1;
      continue;
    }

    await db
      .insertInto('system_prompts')
      .values({
        user_id: userId,
        type: type,
        name: config.name,
        template: template,
        variables: variablesToJSON(type),
        is_active: 1,
        updated_at: new Date().toISOString(),
      } as any)
      .executeTakeFirst();

    created += 1;
  }

  return { created, skipped };
}

export async function listSystemPrompts(
  userId: number,
  options: QueryOptions = {}
): Promise<SystemPromptRecord[]> {
  const db = getDb();
  let query = db
    .selectFrom('system_prompts')
    .where('user_id', '=', userId);

  if (options.type) {
    query = query.where('type', '=', options.type);
  }
  if (options.isActive !== undefined) {
    query = query.where('is_active', '=', options.isActive ? 1 : 0);
  }

  return query
    .selectAll()
    .orderBy('updated_at', 'desc')
    .execute();
}

export async function getSystemPromptById(
  id: number,
  userId: number
): Promise<SystemPromptRecord | undefined> {
  const db = getDb();
  return db
    .selectFrom('system_prompts')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();
}

export async function createSystemPrompt(
  userId: number,
  data: CreateSystemPromptInput
): Promise<{ id: number }> {
  const db = getDb();
  const variables = normalizeVariables(data.variables);
  const result = await db
    .insertInto('system_prompts')
    .values({
      user_id: userId,
      type: data.type.trim(),
      name: data.name.trim(),
      template: data.template,
      variables,
      is_active: data.isActive === undefined ? 1 : data.isActive ? 1 : 0,
      updated_at: new Date().toISOString(),
    } as any)
    .executeTakeFirstOrThrow();

  const insertedId = Number(result.insertId);
  log.info({ userId, promptId: insertedId, type: data.type }, 'System prompt created');
  return { id: insertedId };
}

export async function updateSystemPrompt(
  id: number,
  userId: number,
  data: UpdateSystemPromptInput
): Promise<void> {
  const db = getDb();
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (data.type !== undefined) {
    updateData.type = data.type.trim();
  }
  if (data.name !== undefined) {
    updateData.name = data.name.trim();
  }
  if (data.template !== undefined) {
    updateData.template = data.template;
  }
  if (data.variables !== undefined) {
    updateData.variables = normalizeVariables(data.variables);
  }
  if (data.isActive !== undefined) {
    updateData.is_active = data.isActive ? 1 : 0;
  }

  const result = await db
    .updateTable('system_prompts')
    .set(updateData)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (result.numUpdatedRows === 0n) {
    throw new Error('System prompt not found');
  }

  log.info({ userId, promptId: id }, 'System prompt updated');
}

export async function deleteSystemPrompt(
  id: number,
  userId: number
): Promise<void> {
  const db = getDb();
  const result = await db
    .deleteFrom('system_prompts')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (result.numDeletedRows === 0n) {
    throw new Error('System prompt not found');
  }

  log.info({ userId, promptId: id }, 'System prompt deleted');
}
