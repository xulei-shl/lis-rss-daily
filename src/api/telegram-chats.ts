/**
 * Telegram Chats Service
 *
 * Database operations for managing multiple Telegram chat configurations.
 */

import { getDb, type TelegramChatsSelection } from '../db.js';
import { logger } from '../logger.js';
import {
  PUSH_TYPE_DEFINITIONS,
  getPushType,
  type PushType,
  type TelegramPushField,
} from '../constants/push-types.js';

const log = logger.child({ module: 'telegram-chats-service' });

export type TelegramChatRole = 'admin' | 'viewer';

export type TelegramPushFlags = { [K in TelegramPushField]: boolean };

export type TelegramChatConfig = TelegramPushFlags & {
  id: number;
  userId: number;
  chatId: string;
  chatName: string | null;
  role: TelegramChatRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CreateTelegramChatInput = Partial<TelegramPushFlags> & {
  chatId: string;
  chatName?: string;
  role?: TelegramChatRole;
  isActive?: boolean;
};

export type UpdateTelegramChatInput = Partial<TelegramPushFlags> & {
  chatName?: string;
  role?: TelegramChatRole;
  isActive?: boolean;
};

/**
 * Convert database row to config object
 */
function rowToConfig(row: TelegramChatsSelection): TelegramChatConfig {
  const raw = row as unknown as Record<string, unknown>;
  const pushFlags = {} as TelegramPushFlags;

  for (const type of PUSH_TYPE_DEFINITIONS) {
    pushFlags[type.telegramKey] = raw[type.column] === 1;
  }

  return {
    id: row.id,
    userId: row.user_id,
    chatId: row.chat_id,
    chatName: row.chat_name,
    role: row.role,
    ...pushFlags,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get all Telegram chats for a user
 */
export async function getTelegramChats(userId: number): Promise<TelegramChatConfig[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute();

  return rows.map(rowToConfig);
}

/**
 * Get active Telegram chats for a user
 */
export async function getActiveTelegramChats(userId: number): Promise<TelegramChatConfig[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute();

  return rows.map(rowToConfig);
}

/**
 * Get a specific Telegram chat by ID
 */
export async function getTelegramChatById(userId: number, id: number): Promise<TelegramChatConfig | null> {
  const db = getDb();

  const row = await db
    .selectFrom('telegram_chats')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();

  return row ? rowToConfig(row) : null;
}

/**
 * Get a specific Telegram chat by chat_id
 */
export async function getTelegramChatByChatId(userId: number, chatId: string): Promise<TelegramChatConfig | null> {
  const db = getDb();

  const row = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .where('chat_id', '=', chatId)
    .selectAll()
    .executeTakeFirst();

  return row ? rowToConfig(row) : null;
}

/**
 * Add a new Telegram chat
 */
export async function addTelegramChat(userId: number, input: CreateTelegramChatInput): Promise<TelegramChatConfig> {
  const db = getDb();
  const now = new Date().toISOString();

  const values: Record<string, unknown> = {
    user_id: userId,
    chat_id: input.chatId.trim(),
    chat_name: input.chatName?.trim() || null,
    role: input.role || 'viewer',
    is_active: input.isActive !== false ? 1 : 0,
    updated_at: now,
  };

  for (const type of PUSH_TYPE_DEFINITIONS) {
    const provided = input[type.telegramKey];
    values[type.column] = provided !== undefined
      ? (provided ? 1 : 0)
      : (type.defaultEnabled ? 1 : 0);
  }

  const result = await db
    .insertInto('telegram_chats')
    .values(values as any)
    .returningAll()
    .executeTakeFirstOrThrow();

  log.info({ userId, chatId: input.chatId, role: input.role || 'viewer' }, 'Telegram chat added');

  return rowToConfig(result as TelegramChatsSelection);
}

/**
 * Update a Telegram chat
 */
export async function updateTelegramChat(
  userId: number,
  id: number,
  input: UpdateTelegramChatInput
): Promise<TelegramChatConfig | null> {
  const db = getDb();
  const now = new Date().toISOString();

  // Build update object
  const updates: Record<string, any> = { updated_at: now };

  if (input.chatName !== undefined) {
    updates.chat_name = input.chatName?.trim() || null;
  }
  if (input.role !== undefined) {
    updates.role = input.role;
  }
  if (input.isActive !== undefined) {
    updates.is_active = input.isActive ? 1 : 0;
  }

  for (const type of PUSH_TYPE_DEFINITIONS) {
    const value = input[type.telegramKey];
    if (value !== undefined) {
      updates[type.column] = value ? 1 : 0;
    }
  }

  const result = await db
    .updateTable('telegram_chats')
    .set(updates)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();

  if (!result) {
    return null;
  }

  log.info({ userId, id, updates: Object.keys(input) }, 'Telegram chat updated');

  return rowToConfig(result as TelegramChatsSelection);
}

/**
 * Delete a Telegram chat
 */
export async function deleteTelegramChat(userId: number, id: number): Promise<boolean> {
  const db = getDb();

  const result = await db
    .deleteFrom('telegram_chats')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute();

  const deleted = result.length > 0;

  if (deleted) {
    log.info({ userId, id }, 'Telegram chat deleted');
  }

  return deleted;
}

/**
 * Check if a chat has admin role
 */
export async function isChatAdmin(userId: number, chatId: string): Promise<boolean> {
  const db = getDb();

  const row = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .where('chat_id', '=', chatId)
    .where('is_active', '=', 1)
    .select('role')
    .executeTakeFirst();

  return row?.role === 'admin';
}

/**
 * Get admin chats for a user
 */
export async function getAdminTelegramChats(userId: number): Promise<TelegramChatConfig[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .where('role', '=', 'admin')
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute();

  return rows.map(rowToConfig);
}

/**
 * Get viewer chats for a user
 */
export async function getViewerTelegramChats(userId: number): Promise<TelegramChatConfig[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .where('role', '=', 'viewer')
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute();

  return rows.map(rowToConfig);
}

/**
 * Check if user has any active Telegram chats configured
 */
export async function hasTelegramChats(userId: number): Promise<boolean> {
  const db = getDb();

  const row = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .select('id')
    .executeTakeFirst();

  return !!row;
}

/**
 * Get active chats subscribed to a specific push type
 */
export async function getTelegramChatsForPushType(
  userId: number,
  pushType: PushType
): Promise<TelegramChatConfig[]> {
  const definition = getPushType(pushType);
  const db = getDb();

  const rows = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .where(definition.column as any, '=', 1 as any)
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute();

  return rows.map(rowToConfig);
}
