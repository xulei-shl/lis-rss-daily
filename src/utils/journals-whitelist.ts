/**
 * Journals Whitelist Utility
 *
 * Loads the journals whitelist from config/journals_list.yaml
 * Used for insights article filtering.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { logger } from '../logger.js';

const log = logger.child({ module: 'journals-whitelist' });

let cachedWhitelist: string[] | null = null;

/**
 * Get journals whitelist from config file
 */
export function getJournalsWhitelist(): string[] {
  if (cachedWhitelist) {
    return cachedWhitelist;
  }

  const configPath = path.join(process.cwd(), 'config', 'journals_list.yaml');

  if (!fs.existsSync(configPath)) {
    log.warn({ path: configPath }, 'journals_list.yaml not found, using empty whitelist');
    cachedWhitelist = [];
    return cachedWhitelist;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const data = yaml.load(content) as string[];

    if (!Array.isArray(data)) {
      log.warn('journals_list.yaml content is not an array, using empty whitelist');
      cachedWhitelist = [];
      return cachedWhitelist;
    }

    cachedWhitelist = data.map(item => String(item).trim()).filter(item => item.length > 0);

    log.info({ count: cachedWhitelist.length }, 'Journals whitelist loaded');
    return cachedWhitelist;
  } catch (error) {
    log.error({ error }, 'Failed to load journals_list.yaml, using empty whitelist');
    cachedWhitelist = [];
    return cachedWhitelist;
  }
}

/**
 * Check if a journal name is in the whitelist
 */
export function isInWhitelist(journalName: string): boolean {
  const whitelist = getJournalsWhitelist();
  return whitelist.some(item => item === journalName || item.includes(journalName) || journalName.includes(item));
}

/**
 * Clear cached whitelist (useful for testing or config reload)
 */
export function clearWhitelistCache(): void {
  cachedWhitelist = null;
  log.info('Whitelist cache cleared');
}
