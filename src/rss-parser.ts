/**
 * RSS Parser Module
 *
 * RSS/Atom feed parser using rss-parser library.
 * Provides feed parsing, validation, and error handling.
 */

import Parser from 'rss-parser';
import { logger } from './logger.js';

const log = logger.child({ module: 'rss-parser' });

/**
 * RSS feed item structure
 */
export interface RSSFeedItem {
  title: string;
  link: string;
  pubDate?: string;
  content?: string;
  contentSnippet?: string;
  guid?: string;
  author?: string;
  categories?: string[];
}

/**
 * Parsed RSS feed structure
 */
export interface RSSFeed {
  title: string;
  description?: string;
  link?: string;
  language?: string;
  lastBuildDate?: string;
  items: RSSFeedItem[];
}

/**
 * Result of RSS feed parsing
 */
export interface ParseResult {
  success: boolean;
  feed?: RSSFeed;
  error?: string;
  itemCount: number;
  fetchTime: number;
}

/**
 * RSS source validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  feedTitle?: string;
  itemCount?: number;
}

/**
 * RSS Parser implementation
 */
export class RSSParserImpl {
  private parser: Parser;

  constructor() {
    this.parser = new Parser({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS-Literature-Tracker/1.0)',
        'Accept': 'application/rss+xml, application/rdf+xml, application/atom+xml, application/xml, text/xml',
      },
      customFields: {
        item: ['author', 'categories'],
      },
    });
  }

  /**
   * Parse RSS feed from URL
   * @param url - RSS feed URL
   * @returns Parse result with feed data or error
   */
  async parseFeed(url: string): Promise<ParseResult> {
    const startTime = Date.now();

    try {
      log.debug({ url }, 'Parsing RSS feed');

      const feed = await this.parser.parseURL(url);
      const elapsed = Date.now() - startTime;

      log.info(
        { url, itemCount: feed.items.length, elapsed: `${elapsed}ms` },
        'RSS feed parsed successfully'
      );

      return {
        success: true,
        feed: {
          title: feed.title || 'Untitled Feed',
          description: feed.description,
          link: feed.link,
          language: feed.language,
          lastBuildDate: feed.lastBuildDate,
          items: feed.items.map((item) => ({
            title: item.title || 'Untitled',
            link: item.link || '',
            pubDate: item.pubDate,
            content: item.content || item['content:encoded'],
            contentSnippet: item.contentSnippet,
            guid: item.guid,
            author: item.creator || item.author,
            categories: item.categories || [],
          })),
        },
        itemCount: feed.items.length,
        fetchTime: elapsed,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error(
        { url, error: errorMessage, elapsed: `${elapsed}ms` },
        'Failed to parse RSS feed'
      );

      return {
        success: false,
        error: errorMessage,
        itemCount: 0,
        fetchTime: elapsed,
      };
    }
  }

  /**
   * Validate RSS source (quick check)
   * @param url - RSS feed URL to validate
   * @returns Validation result
   */
  async validateSource(url: string): Promise<ValidationResult> {
    try {
      const result = await this.parseFeed(url);

      if (result.success && result.feed) {
        return {
          valid: true,
          feedTitle: result.feed.title,
          itemCount: result.itemCount,
        };
      }

      return {
        valid: false,
        error: result.error || 'Unknown error',
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Parse RSS feed from raw XML string
   * @param xml - Raw XML string
   * @returns Parse result
   */
  async parseFromString(xml: string): Promise<ParseResult> {
    const startTime = Date.now();

    try {
      log.debug('Parsing RSS feed from string');

      const feed = await this.parser.parseString(xml);
      const elapsed = Date.now() - startTime;

      log.info(
        { itemCount: feed.items.length, elapsed: `${elapsed}ms` },
        'RSS feed parsed successfully from string'
      );

      return {
        success: true,
        feed: {
          title: feed.title || 'Untitled Feed',
          description: feed.description,
          link: feed.link,
          items: feed.items.map((item) => ({
            title: item.title || 'Untitled',
            link: item.link || '',
            pubDate: item.pubDate,
            content: item.content || item['content:encoded'],
            contentSnippet: item.contentSnippet,
            guid: item.guid,
          })),
        },
        itemCount: feed.items.length,
        fetchTime: elapsed,
      };
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error(
        { error: errorMessage, elapsed: `${elapsed}ms` },
        'Failed to parse RSS feed from string'
      );

      return {
        success: false,
        error: errorMessage,
        itemCount: 0,
        fetchTime: elapsed,
      };
    }
  }
}

// Singleton instance
let _instance: RSSParserImpl | null = null;

/**
 * Get RSS parser instance
 */
export function getRSSParser(): RSSParserImpl {
  if (!_instance) {
    _instance = new RSSParserImpl();
  }
  return _instance;
}

/**
 * Initialize RSS parser
 */
export function initRSSParser(): RSSParserImpl {
  return getRSSParser();
}
