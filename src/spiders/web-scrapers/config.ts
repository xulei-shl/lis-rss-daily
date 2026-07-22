/**
 * Web Scraper Configuration
 *
 * Maps scraper_type to script paths and runtime configuration.
 * New scraper types can be added here.
 *
 * Scripts directory: src/spiders/web-scrapers/
 */

import path from 'path';
import { fileURLToPath } from 'url';
import type { WebScraperConfig, WebScraperType } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scraper type to script mapping
 * Each entry defines:
 * - label: Human-readable name
 * - script: Script filename (in the web-scrapers directory)
 * - scriptType: Runtime ('python' or 'javascript')
 */
const SCRAPER_MAP: Record<WebScraperType, WebScraperConfig> = {
  lsc: {
    scraperType: 'lsc',
    label: '中图学会',
    script: 'lsc-scraper.py',
    scriptType: 'python',
  },
};

/**
 * Get all scraper type codes
 */
export function getScraperTypeCodes(): string[] {
  return Object.keys(SCRAPER_MAP);
}

/**
 * Get scraper config by type code
 */
export function getScraperConfig(code: string): WebScraperConfig | undefined {
  return SCRAPER_MAP[code as WebScraperType];
}

/**
 * Get all scraper configs (for API responses)
 */
export function getAllScraperConfigs(): WebScraperConfig[] {
  return Object.values(SCRAPER_MAP);
}

/**
 * Get the full path to a scraper script
 */
export function getScraperScriptPath(code: string): string | undefined {
  const config = SCRAPER_MAP[code as WebScraperType];
  if (!config) return undefined;
  return path.join(__dirname, config.script);
}

/**
 * Get the scripts directory path
 */
export function getScrapersDir(): string {
  return __dirname;
}
