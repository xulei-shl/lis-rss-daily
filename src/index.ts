/**
 * RSS 文献追踪系统 - Main Entry Point
 *
 * Entry point for the application.
 * Initializes database, logger, and starts web server.
 */

import 'dotenv/config';
import { initLogger, logger } from './logger.js';
import { initDb, closeDb } from './db.js';
import { initRSSParser } from './rss-parser.js';
import { initRSSScheduler } from './rss-scheduler.js';
import { initRelatedScheduler } from './related-scheduler.js';
import { initJournalScheduler } from './journal-scheduler.js';
import { initKeywordScheduler } from './keyword-scheduler.js';
import { initTelegramBotManager } from './telegram/bot-manager.js';
import { config } from './config.js';
import { createApp, startServer } from './api/web.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = logger.child({ module: 'main' });

async function main() {
  // Initialize logger
  initLogger();
  log.info('🚀 LIS-RSS Literature Tracker starting...');

  // Log configuration
  log.info({
    port: config.port,
    database: config.databasePath,
    llmProvider: config.llmProvider,
    rssFetchEnabled: config.rssFetchEnabled,
    rssFetchSchedule: config.rssFetchSchedule,
    relatedRefreshEnabled: config.relatedRefreshEnabled,
    relatedRefreshSchedule: config.relatedRefreshSchedule,
  }, 'Configuration loaded');

  // Initialize database
  log.info('Initializing database...');
  initDb();
  log.info('✅ Database initialized');

  // Initialize RSS parser
  initRSSParser();
  log.info('✅ RSS parser initialized');

  // Configure Express app
  const app = createApp();
  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.set('view options', {
    layout: false
  });

  // Start web server
  const server = startServer(app);

  // Initialize and start RSS scheduler
  const scheduler = initRSSScheduler();
  if (config.rssFetchEnabled) {
    scheduler.start();
    log.info(`📅 RSS scheduler started (schedule: ${config.rssFetchSchedule})`);
  } else {
    log.info('📅 RSS scheduler disabled');
  }

  // Initialize and start Related Articles refresh scheduler
  const relatedScheduler = initRelatedScheduler({
    enabled: config.relatedRefreshEnabled,
    schedule: config.relatedRefreshSchedule,
    batchSize: config.relatedRefreshBatchSize,
    staleDays: config.relatedRefreshStaleDays,
  });
  if (config.relatedRefreshEnabled) {
    relatedScheduler.start();
    log.info(`🔄 Related articles scheduler started (schedule: ${config.relatedRefreshSchedule})`);
  } else {
    log.info('🔄 Related articles scheduler disabled');
  }

  // Initialize and start Journal scheduler
  const journalScheduler = initJournalScheduler();
  const journalCrawlEnabled = process.env.JOURNAL_CRAWL_ENABLED !== 'false';
  const journalCrawlSchedule = process.env.JOURNAL_CRAWL_SCHEDULE || '15 2 * * 6';
  if (journalCrawlEnabled) {
    journalScheduler.start();
    log.info(`📚 Journal scheduler started (schedule: ${journalCrawlSchedule})`);
  } else {
    log.info('📚 Journal scheduler disabled');
  }

  // Initialize and start Keyword scheduler
  const keywordScheduler = initKeywordScheduler();
  const keywordCrawlEnabled = process.env.KEYWORD_CRAWL_ENABLED !== 'false';
  const keywordCrawlSchedule = process.env.KEYWORD_CRAWL_SCHEDULE || '15 3 * * 6';
  if (keywordCrawlEnabled) {
    keywordScheduler.start();
    log.info(`🔑 Keyword scheduler started (schedule: ${keywordCrawlSchedule})`);
  } else {
    log.info('🔑 Keyword scheduler disabled');
  }

  // Initialize and start Telegram Bot
  const telegramBotManager = await initTelegramBotManager();
  if (telegramBotManager) {
    log.info('🤖 Telegram bot manager started');
  } else {
    log.info('🤖 Telegram bot manager: No enabled users');
  }

  // Keep process running
  log.info('✅ Application ready. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('🛑 Shutting down gracefully...');

    // Stop scheduler
    await scheduler.stop();
    log.info('📅 RSS scheduler stopped');

    // Stop related articles scheduler
    await relatedScheduler.stop();
    log.info('🔄 Related articles scheduler stopped');

    // Stop journal scheduler
    await journalScheduler.stop();
    log.info('📚 Journal scheduler stopped');

    // Stop keyword scheduler
    await keywordScheduler.stop();
    log.info('🔑 Keyword scheduler stopped');

    // Stop Telegram bot manager
    if (telegramBotManager) {
      await telegramBotManager.stop();
      log.info('🤖 Telegram bot manager stopped');
    }

    server.close(() => {
      log.info('🌐 Web server closed');
    });
    await closeDb();
    log.info('👋 Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  log.error({ error }, '❌ Failed to start application');
  process.exit(1);
});
