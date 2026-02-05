/**
 * QMD Utilities: Manage file symlinks/copies for QMD indexing.
 *
 * Phase 8: QMD Integration
 *
 * This module handles:
 * - QMD collection directory initialization
 * - Creating symlinks/copies of exported markdown files to QMD collection
 * - Removing symlinks/copies from QMD collection
 * - QMD collection configuration (qmd collection add)
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { config } from './config.js';

const log = logger.child({ module: 'qmd' });

const EXPORT_DIR = process.env.ARTICLE_EXPORT_DIR || path.join(process.cwd(), 'data', 'exports');
const QMD_ARTICLES_DIR = path.join(config.qmdCollectionPath, config.qmdArticlesCollection);

/**
 * Initialize QMD collection directory.
 * Creates the directory if it doesn't exist.
 */
export function initQmdCollection(): void {
  try {
    fs.mkdirSync(QMD_ARTICLES_DIR, { recursive: true });
    log.info({ path: QMD_ARTICLES_DIR }, 'QMD collection directory initialized');
  } catch (error) {
    log.error({ error }, 'Failed to initialize QMD collection directory');
    throw error;
  }
}

/**
 * Create a symlink or copy the exported markdown file to QMD collection.
 * Prefers symlinks on Unix-like systems, falls back to copy on Windows
 * or if symlink creation fails.
 *
 * @param exportFilename - Filename of the exported markdown file (e.g., "123-article-title.md")
 * @returns Path to the symlink/copied file in QMD collection
 */
export function linkFileToQmdCollection(exportFilename: string): string {
  const sourcePath = path.join(EXPORT_DIR, exportFilename);
  const targetPath = path.join(QMD_ARTICLES_DIR, exportFilename);

  // Ensure target directory exists
  fs.mkdirSync(QMD_ARTICLES_DIR, { recursive: true });

  // Check if source file exists
  if (!fs.existsSync(sourcePath)) {
    log.warn({ source: sourcePath }, 'Source file does not exist, skipping QMD link');
    return targetPath;
  }

  // Remove existing target if present
  if (fs.existsSync(targetPath)) {
    try {
      fs.unlinkSync(targetPath);
    } catch (error) {
      log.debug({ error, path: targetPath }, 'Failed to remove existing target');
    }
  }

  // Try creating symlink first (Unix-like systems)
  if (process.platform !== 'win32') {
    try {
      fs.symlinkSync(sourcePath, targetPath);
      log.debug({ source: sourcePath, target: targetPath }, 'Created symlink to QMD collection');
      return targetPath;
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        log.debug({ error: error.message }, 'Symlink creation failed, falling back to copy');
      }
    }
  }

  // Fallback: Copy file (Windows or symlink failed)
  try {
    fs.copyFileSync(sourcePath, targetPath);
    log.debug({ source: sourcePath, target: targetPath }, 'Copied file to QMD collection');
    return targetPath;
  } catch (error) {
    log.error({ error, source: sourcePath, target: targetPath }, 'Failed to copy file to QMD collection');
    throw error;
  }
}

/**
 * Remove the symlink/copied file from QMD collection.
 *
 * @param exportFilename - Filename of the exported markdown file
 * @returns true if file was removed, false if not found
 */
export function unlinkFileFromQmdCollection(exportFilename: string): boolean {
  const targetPath = path.join(QMD_ARTICLES_DIR, exportFilename);

  try {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
      log.debug({ path: targetPath }, 'Removed file from QMD collection');
      return true;
    }
  } catch (error) {
    log.warn({ error, path: targetPath }, 'Failed to remove file from QMD collection');
  }

  return false;
}

/**
 * Initialize QMD collection configuration.
 * Adds the articles directory to QMD as a collection if not already configured.
 * This should be called once on application startup.
 *
 * Prerequisites: QMD must be installed globally (bun install -g github:tobi/qmd)
 */
export async function initQmdCollectionConfig(): Promise<void> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    // Check if QMD is installed
    try {
      await execAsync('qmd --version', { encoding: 'utf-8', timeout: 5000 });
    } catch (error) {
      log.warn('QMD is not installed. Semantic search will fall back to SQLite LIKE.');
      log.info('To enable QMD semantic search, run: bun install -g github:tobi/qmd');
      return;
    }

    // Check if collection already exists
    const { stdout } = await execAsync('qmd collection list', { encoding: 'utf-8', timeout: 5000 });
    const hasArticlesCollection = stdout.includes(config.qmdArticlesCollection);

    if (!hasArticlesCollection) {
      log.info(
        { collection: config.qmdArticlesCollection, path: QMD_ARTICLES_DIR },
        'Adding QMD collection...'
      );
      await execAsync(`qmd collection add "${QMD_ARTICLES_DIR}" --name ${config.qmdArticlesCollection}`, {
        encoding: 'utf-8',
        timeout: 10000,
      });
      log.info('QMD collection added successfully');
    } else {
      log.debug({ collection: config.qmdArticlesCollection }, 'QMD collection already exists');
    }
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to initialize QMD collection config. Semantic search may not work.'
    );
  }
}

/**
 * Check if QMD is properly configured and available.
 *
 * @returns true if QMD is installed and configured, false otherwise
 */
export async function isQmdAvailable(): Promise<boolean> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  try {
    await execAsync('qmd --version', { encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
