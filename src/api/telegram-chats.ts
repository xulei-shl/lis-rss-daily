/**
 * Telegram Chats Service
 *
 * Database operations for managing multiple Telegram chat configurations.
 */

import { getDb, type TelegramChatsSelection } from '../db.js';
import { logger } from '../logger.js';
import type { Generated } from 'kysely';

const log = logger.child({ module: 'telegram-chats-service' });

export type TelegramChatRole = 'admin' | 'viewer';

export interface TelegramChatConfig {
  id: number;
  userId: number;
  chatId: string;
  chatName: string | null;
  role: TelegramChatRole;
  dailySummary: boolean;
  newArticles: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTelegramChatInput {
  chatId: string;
  chatName?: string;
  role?: TelegramChatRole;
  dailySummary?: boolean;
  newArticles?: boolean;
  isActive?: boolean;
}

export interface UpdateTelegramChatInput {
  chatName?: string;
  role?: TelegramChatRole;
  dailySummary?: boolean;
  newArticles?: boolean;
  isActive?: boolean;
}

/**
 * Convert database row to config object
 */
function rowToConfig(row: TelegramChatsSelection): TelegramChatConfig {
  return {
    id: row.id,
    userId: row.user_id,
    chatId: row.chat_id,
    chatName: row.chat_name,
    role: row.role,
    dailySummary: row.daily_summary === 1,
    newArticles: row.new_articles === 1,
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

  const result = await db
    .insertInto('telegram_chats')
    .values({
      user_id: userId,
      chat_id: input.chatId.trim(),
      chat_name: input.chatName?.trim() || null,
      role: input.role || 'viewer',
      daily_summary: input.dailySummary !== false ? 1 : 0,
      new_articles: input.newArticles !== false ? 1 : 0,
      is_active: input.isActive !== false ? 1 : 0,
      updated_at: now,
    } as any)
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
  if (input.dailySummary !== undefined) {
    updates.daily_summary = input.dailySummary ? 1 : 0;
  }
  if (input.newArticles !== undefined) {
    updates.new_articles = input.newArticles ? 1 : 0;
  }
  if (input.isActive !== undefined) {
    updates.is_active = input.isActive ? 1 : 0;
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
 * Get chats that should receive daily summary
 */
export async function getDailySummaryChats(userId: number): Promise<TelegramChatConfig[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .where('daily_summary', '=', 1)
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute();

  return rows.map(rowToConfig);
}

/**
 * Get chats that should receive new articles
 */
export async function getNewArticlesChats(userId: number): Promise<TelegramChatConfig[]> {
  const db = getDb();

  const rows = await db
    .selectFrom('telegram_chats')
    .where('user_id', '=', userId)
    .where('is_active', '=', 1)
    .where('new_articles', '=', 1)
    .orderBy('created_at', 'asc')
    .selectAll()
    .execute();

  return rows.map(rowToConfig);
}
