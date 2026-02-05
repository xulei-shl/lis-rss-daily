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
  log.info('🚀 RSS Literature Tracker starting...');

  // Log configuration
  log.info({
    port: config.port,
    database: config.databasePath,
    llmProvider: config.llmProvider,
    rssFetchEnabled: config.rssFetchEnabled,
    rssFetchSchedule: config.rssFetchSchedule,
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

  // Keep process running
  log.info('✅ Application ready. Press Ctrl+C to stop.');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('🛑 Shutting down gracefully...');

    // Stop scheduler
    await scheduler.stop();
    log.info('📅 RSS scheduler stopped');

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
