/**
 * 系统提示词服务
 *
 * 负责 system_prompts 表的 CRUD 操作。
 */

import { getDb, type SystemPromptsTable } from '../db.js';
import { logger } from '../logger.js';

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
    })
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

  if (result.numUpdatedRows === 0) {
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

  if (result.numDeletedRows === 0) {
    throw new Error('System prompt not found');
  }

  log.info({ userId, promptId: id }, 'System prompt deleted');
}
