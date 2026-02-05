/**
 * Settings Service
 *
 * Database operations for user settings management.
 * Settings are stored as key-value pairs in the settings table.
 */

import { getDb } from '../db.js';
import { logger } from '../logger.js';

const log = logger.child({ module: 'settings-service' });

/**
 * Setting value type
 */
export type SettingValue = string | number | boolean;

/**
 * Get user setting
 * @param userId - User ID
 * @param key - Setting key
 * @returns Setting value or null
 */
export async function getUserSetting(
  userId: number,
  key: string
): Promise<string | null> {
  const db = getDb();

  const result = await db
    .selectFrom('settings')
    .where('user_id', '=', userId)
    .where('key', '=', key)
    .select('value')
    .executeTakeFirst();

  return result?.value ?? null;
}

/**
 * Set user setting
 * @param userId - User ID
 * @param key - Setting key
 * @param value - Setting value
 */
export async function setUserSetting(
  userId: number,
  key: string,
  value: SettingValue
): Promise<void> {
  const db = getDb();
  const stringValue = String(value);
  const now = new Date().toISOString();

  // Check if already exists
  const existing = await db
    .selectFrom('settings')
    .where('user_id', '=', userId)
    .where('key', '=', key)
    .select('id')
    .executeTakeFirst();

  if (existing) {
    // Update
    await db
      .updateTable('settings')
      .set({
        value: stringValue,
        updated_at: now,
      })
      .where('id', '=', existing.id)
      .execute();
  } else {
    // Insert
    await db
      .insertInto('settings')
      .values({
        user_id: userId,
        key,
        value: stringValue,
        updated_at: now,
      })
      .execute();
  }

  log.info({ userId, key, value }, 'Setting updated');
}

/**
 * Get multiple user settings
 * @param userId - User ID
 * @param keys - Setting keys
 * @returns Record of key-value pairs
 */
export async function getUserSettings(
  userId: number,
  keys: string[]
): Promise<Record<string, string>> {
  const db = getDb();

  const results = await db
    .selectFrom('settings')
    .where('user_id', '=', userId)
    .where('key', 'in', keys)
    .select(['key', 'value'])
    .execute();

  const settings: Record<string, string> = {};

  for (const result of results) {
    settings[result.key] = result.value;
  }

  return settings;
}

/**
 * Get all user settings
 * @param userId - User ID
 * @returns Record of all key-value pairs
 */
export async function getAllUserSettings(
  userId: number
): Promise<Record<string, string>> {
  const db = getDb();

  const results = await db
    .selectFrom('settings')
    .where('user_id', '=', userId)
    .select(['key', 'value'])
    .execute();

  const settings: Record<string, string> = {};

  for (const result of results) {
    settings[result.key] = result.value;
  }

  return settings;
}

/**
 * Delete user setting
 * @param userId - User ID
 * @param key - Setting key
 */
export async function deleteUserSetting(
  userId: number,
  key: string
): Promise<void> {
  const db = getDb();

  await db
    .deleteFrom('settings')
    .where('user_id', '=', userId)
    .where('key', '=', key)
    .execute();

  log.info({ userId, key }, 'Setting deleted');
}

/**
 * Batch set user settings
 * @param userId - User ID
 * @param settings - Key-value pairs
 */
export async function batchSetUserSettings(
  userId: number,
  settings: Record<string, SettingValue>
): Promise<void> {
  for (const [key, value] of Object.entries(settings)) {
    await setUserSetting(userId, key, value);
  }

  log.info({ userId, count: Object.keys(settings).length }, 'Batch settings updated');
}

/**
 * Get scheduler-related settings
 * @param userId - User ID
 */
export async function getSchedulerSettings(userId: number): Promise<{
  rssFetchSchedule: string;
  rssFetchEnabled: boolean;
  maxConcurrentFetch: number;
}> {
  const settings = await getUserSettings(userId, [
    'rss_fetch_schedule',
    'rss_fetch_enabled',
    'max_concurrent_fetch',
  ]);

  return {
    rssFetchSchedule: settings.rss_fetch_schedule || '0 9 * * *',
    rssFetchEnabled: settings.rss_fetch_enabled !== 'false',
    maxConcurrentFetch: parseInt(settings.max_concurrent_fetch || '5', 10),
  };
}

/**
 * Update scheduler settings
 * @param userId - User ID
 * @param settings - Scheduler settings
 */
export async function updateSchedulerSettings(
  userId: number,
  settings: {
    rssFetchSchedule?: string;
    rssFetchEnabled?: boolean;
    maxConcurrentFetch?: number;
  }
): Promise<void> {
  const updates: Record<string, SettingValue> = {};

  if (settings.rssFetchSchedule !== undefined) {
    updates.rss_fetch_schedule = settings.rssFetchSchedule;
  }

  if (settings.rssFetchEnabled !== undefined) {
    updates.rss_fetch_enabled = settings.rssFetchEnabled;
  }

  if (settings.maxConcurrentFetch !== undefined) {
    updates.max_concurrent_fetch = settings.maxConcurrentFetch;
  }

  if (Object.keys(updates).length > 0) {
    await batchSetUserSettings(userId, updates);
    log.info({ userId, settings: updates }, 'Scheduler settings updated');
  }
}
