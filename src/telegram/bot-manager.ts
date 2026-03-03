/**
 * Telegram Bot Manager
 *
 * Manages multiple Telegram Bot instances for different users.
 * Provides centralized initialization and lifecycle management.
 * Supports multiple chat IDs per user with different permission levels.
 */

import { logger } from '../logger.js';
import { TelegramBot } from './bot.js';
import { getUserSetting } from '../api/settings.js';
import { getActiveTelegramChats, type TelegramChatConfig } from '../api/telegram-chats.js';

const log = logger.child({ module: 'telegram-bot-manager' });

interface UserTelegramConfig {
  userId: number;
  botToken: string;
  chats: TelegramChatConfig[];
}

class TelegramBotManager {
  private bots: Map<number, TelegramBot> = new Map();
  private isRunning: boolean = false;

  /**
   * Initialize and start all bots for enabled users
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('Bot manager already running');
      return;
    }

    log.info('Initializing Telegram bot manager...');

    // Get all users with Telegram enabled
    const configs = await this.getEnabledUserConfigs();

    if (configs.length === 0) {
      log.info('No users with Telegram enabled');
      return;
    }

    // Start bot for each user
    let startedCount = 0;
    for (const config of configs) {
      try {
        const bot = new TelegramBot(config.botToken, config.userId, config.chats);
        await bot.start();
        this.bots.set(config.userId, bot);
        startedCount++;
      } catch (error) {
        log.error({ userId: config.userId, error }, 'Failed to start bot for user');
      }
    }

    if (startedCount > 0) {
      log.info({ count: startedCount }, 'Telegram bot manager started');
    }

    this.isRunning = true;
  }

  /**
   * Stop all bots
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    log.info('Stopping Telegram bot manager...');

    const stopPromises = Array.from(this.bots.values()).map((bot) => bot.stop());
    await Promise.all(stopPromises);
    this.bots.clear();

    this.isRunning = false;
    log.info('Telegram bot manager stopped');
  }

  /**
   * Get bot for a specific user
   */
  getBot(userId: number): TelegramBot | undefined {
    return this.bots.get(userId);
  }

  /**
   * Get all active user Telegram configurations
   * Note: This is a simplified implementation that assumes a single user (id=1)
   * For multi-user support, the users table would need to be queried
   */
  private async getEnabledUserConfigs(): Promise<UserTelegramConfig[]> {
    // For now, just check user 1 (the default user)
    // TODO: Extend to query all users from the users table
    const userId = 1;

    // Check if Telegram is enabled for this user
    const enabled = await getUserSetting(userId, 'telegram_enabled');

    if (enabled !== 'true') {
      return [];
    }

    // Get bot token
    const botToken = await getUserSetting(userId, 'telegram_bot_token');

    if (!botToken) {
      return [];
    }

    // Get all active chats for this user
    const chats = await getActiveTelegramChats(userId);

    if (chats.length === 0) {
      log.debug({ userId }, 'No active Telegram chats configured');
      return [];
    }

    return [
      {
        userId,
        botToken,
        chats,
      },
    ];
  }
}

// Singleton instance
let _instance: TelegramBotManager | null = null;

/**
 * Get Telegram bot manager instance
 */
export function getBotManager(): TelegramBotManager {
  if (!_instance) {
    _instance = new TelegramBotManager();
  }
  return _instance;
}

/**
 * Initialize and start Telegram bot manager
 */
export async function initTelegramBotManager(): Promise<TelegramBotManager | null> {
  const manager = getBotManager();
  await manager.start();

  // Check if any bots were started
  if (manager['bots'].size === 0) {
    return null;
  }

  return manager;
}
