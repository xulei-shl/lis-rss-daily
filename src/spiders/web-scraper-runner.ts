/**
 * Web Scraper Runner
 *
 * Executes web scraper scripts (Python or JavaScript) that connect to a
 * Playwright browser via CDP, scrape a target URL, and output JSON articles.
 *
 * Each script receives:
 *   - TARGET_URL env var: the URL to scrape (from web_source.url)
 *   - BROWSER_ADDRESS env var: Playwright CDP WebSocket address
 *
 * Scripts must output a JSON array of { title, link, summary?, date? } to stdout.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';
import { config } from '../config.js';
import { getScraperConfig, getScraperScriptPath } from './web-scrapers/config.js';
import type { WebScraperResult, WebScrapedArticle } from './types.js';

const log = logger.child({ module: 'web-scraper-runner' });

const HTTP_PROXY = process.env.HTTP_PROXY || null;
const BROWSER_ADDRESS = process.env.BROWSER_ADDRESS || 'ws://127.0.0.1:9222';

/**
 * Resolve Python interpreter path (same logic as PythonSpiderRunner)
 */
function resolvePythonPath(): string {
  const configuredPath = process.env.PYTHON_PATH?.trim();
  if (configuredPath) {
    if (existsSync(configuredPath)) {
      return configuredPath;
    }
    log.warn({ pythonPath: configuredPath, source: 'PYTHON_PATH' }, 'Configured Python interpreter not found');
  }

  const candidates = [
    path.join(process.cwd(), 'venv', 'bin', 'python'),
    path.join(process.cwd(), 'lis-rss', 'bin', 'python'),
    '/home/xulei/.pyenvs/env_camoufox/bin/python',
    '/usr/bin/python3',
    '/usr/local/bin/python3',
  ];

  const resolvedPath = candidates.find(candidate => existsSync(candidate));
  if (resolvedPath) {
    return resolvedPath;
  }

  return path.join(process.cwd(), 'venv', 'bin', 'python');
}

/**
 * Resolve Node.js path
 */
function resolveNodePath(): string {
  return process.env.NODE_PATH || process.execPath || 'node';
}

/**
 * Run a web scraper script and return scraped articles
 *
 * @param scraperType - The scraper type code (e.g., 'lsc')
 * @param targetUrl - The URL to scrape
 * @returns Scraper result with articles
 */
export async function runWebScraper(
  scraperType: string,
  targetUrl: string
): Promise<WebScraperResult> {
  const config = getScraperConfig(scraperType);
  if (!config) {
    return {
      success: false,
      articles: [],
      error: `Unknown scraper type: ${scraperType}`,
    };
  }

  const scriptPath = getScraperScriptPath(scraperType);
  if (!scriptPath || !existsSync(scriptPath)) {
    return {
      success: false,
      articles: [],
      error: `Scraper script not found for type: ${scraperType} (expected: ${scriptPath})`,
    };
  }

  return new Promise((resolve, reject) => {
    const runLog = log.child({ scraperType, targetUrl, script: path.basename(scriptPath) });

    // Determine the command based on script type
    let command: string;
    let args: string[];

    if (config.scriptType === 'python') {
      command = resolvePythonPath();
      args = [scriptPath];
    } else {
      command = resolveNodePath();
      args = [scriptPath];
    }

    // Build environment variables
    const env = {
      ...process.env,
      TARGET_URL: targetUrl,
      BROWSER_ADDRESS,
      ...(HTTP_PROXY && { HTTP_PROXY }),
      ...(HTTP_PROXY && { HTTPS_PROXY: HTTP_PROXY }),
      ...(HTTP_PROXY && { http_proxy: HTTP_PROXY }),
      ...(HTTP_PROXY && { https_proxy: HTTP_PROXY }),
    };

    runLog.info({ command, args, cwd: path.dirname(scriptPath) }, 'Running web scraper');

    const startTime = Date.now();
    const proc = spawn(command, args, {
      cwd: path.dirname(scriptPath),
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // Log progress/debug output from script
      log.debug({ output: data.toString().trim(), scraperType }, 'Scraper stderr');
    });

    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      runLog.info({ code, duration, stdoutLength: stdout.length }, 'Web scraper finished');

      if (code !== 0 && code !== null) {
        const errorMessage = stderr || `Process exited with code ${code}`;
        runLog.error({ code, stderr }, 'Web scraper failed');
        resolve({
          success: false,
          articles: [],
          error: errorMessage,
        });
        return;
      }

      // Parse JSON output
      try {
        const data = JSON.parse(stdout.trim());

        // Check if the output is a single object with {success: false, error}
        if (!Array.isArray(data) && data.success === false) {
          resolve({
            success: false,
            articles: [],
            error: data.error || 'Unknown error from scraper',
          });
          return;
        }

        // Normalize to array
        const rawArticles: any[] = Array.isArray(data) ? data : [];

        const articles: WebScrapedArticle[] = rawArticles
          .filter((item: any) => {
            if (!item || !item.title || !item.title.trim()) {
              log.debug({ item }, 'Skipping article without title');
              return false;
            }
            if (!item.link || !item.link.trim()) {
              log.debug({ item }, 'Skipping article without link');
              return false;
            }
            return true;
          })
          .map((item: any) => ({
            title: item.title.trim(),
            link: item.link.trim(),
            summary: item.summary?.trim() || undefined,
            date: item.date?.trim() || undefined,
          }));

        runLog.info({ articleCount: articles.length }, 'Parsed web scraper output');
        resolve({
          success: true,
          articles,
        });
      } catch (e) {
        runLog.warn({ stdout: stdout.substring(0, 500), error: e }, 'JSON parse failed');
        resolve({
          success: false,
          articles: [],
          error: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    });

    proc.on('error', (err) => {
      runLog.error({ error: err }, 'Failed to start scraper process');
      reject(err);
    });

    // Set timeout
    const timeout = parseInt(process.env.WEB_SCRAPER_TIMEOUT || '120000', 10); // Default 2 minutes
    setTimeout(() => {
      if (!proc.killed) {
        log.warn({ scraperType, targetUrl, timeout }, 'Web scraper timeout, killing process');
        proc.kill();
        resolve({
          success: false,
          articles: [],
          error: `Scraper timeout after ${timeout}ms`,
        });
      }
    }, timeout);
  });
}

/**
 * Parse a scraped date string into a Date object or ISO string.
 * Handles formats: "DD-MM", "YYYY-MM-DD", "YYYY-MM"
 */
export function parseScrapedDate(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined;

  const trimmed = dateStr.trim();

  // Try YYYY-MM-DD format
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    const [, year, month, day] = ymdMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try DD-MM format (use current year)
  const dmMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})$/);
  if (dmMatch) {
    const [, day, month] = dmMatch;
    const currentYear = new Date().getFullYear();
    // If month is greater than 12, swap (likely month-day format like "07-15")
    if (parseInt(month) > 12) {
      return `${currentYear}-${day.padStart(2, '0')}-${month.padStart(2, '0')}`;
    }
    return `${currentYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try YYYY-MM format (use first day of month)
  const ymMatch = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (ymMatch) {
    const [, year, month] = ymMatch;
    return `${year}-${month.padStart(2, '0')}-01`;
  }

  return undefined;
}
