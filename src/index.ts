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
import { qmdIndexQueue } from './export.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const log = logger.child({ module: 'main' });

function startQmdAutoEmbedWatcher(): fs.FSWatcher | undefined {
  const watchDir = path.join(config.qmdCollectionPath, config.qmdArticlesCollection);
  const debounceMs = parseInt(process.env.QMD_AUTO_EMBED_DEBOUNCE_MS || '30000', 10);
  let timer: NodeJS.Timeout | undefined;

  try {
    const watcher = fs.watch(watchDir, { persistent: true }, (_eventType, filename) => {
      if (filename && !filename.endsWith('.md')) return;

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        qmdIndexQueue.requestUpdate().catch((error) => {
          log.warn({ error }, 'QMD auto embed request failed');
        });
      }, debounceMs);
    });

    watcher.on('error', (error) => {
      log.warn({ error }, 'QMD auto embed watcher error');
    });

    log.info({ path: watchDir, debounceMs }, 'QMD auto embed watcher started');
    return watcher;
  } catch (error) {
    log.warn({ error, path: watchDir }, 'QMD auto embed watcher failed to start');
    return undefined;
  }
}

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
    qmdEnabled: config.qmdEnabled,
    qmdCollectionPath: config.qmdCollectionPath,
  }, 'Configuration loaded');

  // Initialize database
  log.info('Initializing database...');
  initDb();
  log.info('✅ Database initialized');

  // Initialize RSS parser
  initRSSParser();
  log.info('✅ RSS parser initialized');

  // Phase 8: Initialize QMD collection (if enabled)
  let qmdWatcher: fs.FSWatcher | undefined;
  if (config.qmdEnabled) {
    try {
      const { initQmdCollection, initQmdCollectionConfig } = await import('./qmd.js');
      initQmdCollection();
      await initQmdCollectionConfig();
      qmdWatcher = startQmdAutoEmbedWatcher();
      log.info('✅ QMD semantic search initialized');
    } catch (error) {
      log.warn({ error }, '⚠️  QMD initialization failed, semantic search will be disabled');
      log.info('   To enable QMD, install it globally: bun install -g github:tobi/qmd');
    }
  } else {
    log.info('ℹ️  QMD semantic search disabled (set QMD_ENABLED=true to enable)');
  }

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

    if (qmdWatcher) {
      qmdWatcher.close();
      log.info('🔎 QMD watcher stopped');
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
