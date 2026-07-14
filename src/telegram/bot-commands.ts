/**
 * Telegram Bot — Command Handler
 *
 * Handles /getarticles command processing (by date, source, or keyword search).
 * Extracted from bot.ts for single-responsibility separation.
 */

import { logger } from '../logger.js';
import { TelegramClient } from './client.js';
import { getUserArticles } from '../api/articles.js';
import { parseGetArticlesCommand, type GetArticlesDateCommand, type GetArticlesSourceCommand } from './command-parser.js';
import { createArticleKeyboard, formatNewArticle } from './formatters.js';
import type { MergedSourceOption } from '../api/articles.js';
import { serializeError } from './utils.js';

const log = logger.child({ module: 'telegram-bot-commands' });

/**
 * Dependencies required by CommandHandler
 */
export interface CommandHandlerDeps {
  client: TelegramClient;
  userId: number;
  getSources(): Promise<MergedSourceOption[]>;
  matchSourceName(name: string, sources: MergedSourceOption[]): MergedSourceOption | null;
  escapeHtml(text: string): string;
  getTelegramAiSummary(aiSummary: string | null | undefined): string;
}

/**
 * Command Handler
 *
 * Parses and handles /getarticles commands from Telegram messages.
 * Supports three sub-commands:
 * - /getarticles YYYY-MM-DD — articles by date
 * - /getarticles SourceName — articles by source (falls back to keyword search)
 * - Optional @all flag to include read articles
 */
export class CommandHandler {
  private deps: CommandHandlerDeps;

  constructor(deps: CommandHandlerDeps) {
    this.deps = deps;
  }

  /**
   * Handle incoming /getarticles command
   * @param text - Full command text (e.g., "/getarticles 2026-3-1")
   * @param chatId - Target chat ID
   */
  async handleGetArticlesCommand(text: string, chatId: string): Promise<void> {
    try {
      const parsed = parseGetArticlesCommand(text);
      if (!parsed) {
        await this.deps.client.sendMessage(chatId,
          '❌ 格式错误。\n' +
          '按日期：/getarticles YYYY-MM-DD 或 YYYYMMDD\n' +
          '按来源：/getarticles 来源名称\n' +
          '可选：添加 @all 返回所有文章（不限已读/未读）\n' +
          '例如：/getarticles 2026-3-1 或 /getarticles MIT Technology Review @all');
        return;
      }

      if (parsed.type === 'date') {
        await this.handleGetArticlesByDate(parsed, chatId);
      } else {
        await this.handleGetArticlesBySource(parsed, chatId);
      }
    } catch (error) {
      log.error({ error, text }, 'Error in getarticles command');
      await this.deps.client.sendMessage(chatId, '❌ 查询失败，请稍后重试');
    }
  }

  /**
   * Handle /getarticles command by date
   */
  private async handleGetArticlesByDate(command: GetArticlesDateCommand, chatId: string): Promise<void> {
    const { year, month, day, includeAll } = command;
    const { userId, client } = this.deps;
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const result = await getUserArticles(userId, {
      createdAfter: dateStr,
      createdBefore: dateStr,
      isRead: includeAll ? undefined : false,
      filterStatus: 'passed',
      limit: 5,
      page: 1,
      randomOrder: true,
    });

    const statusText = includeAll ? '所有' : '未读';
    await this.sendArticleBatch(result.articles, chatId, {
      summaryMessage: `📚 找到 ${result.articles.length} 篇${year}年${month}月${day}日的${statusText}文章：`,
      emptyMessage: `📭 ${year}年${month}月${day}日没有符合条件的${statusText}文章`,
      logLabel: '/getarticles command',
      logContext: { year, month, day },
    });
  }

  /**
   * Handle /getarticles command by source name
   */
  private async handleGetArticlesBySource(command: GetArticlesSourceCommand, chatId: string): Promise<void> {
    const { name, includeAll } = command;
    const { userId, client } = this.deps;
    const sources = await this.deps.getSources();
    const matchedSource = this.deps.matchSourceName(name, sources);

    // Fallback: if no source matched, treat as keyword search
    if (!matchedSource) {
      await this.handleGetArticlesBySearch(name, chatId, includeAll);
      return;
    }

    const queryParams: any = {
      isRead: includeAll ? undefined : false,
      filterStatus: 'passed',
      limit: 5,
      page: 1,
      randomOrder: true,
    };

    if (matchedSource.rssIds) queryParams.rssSourceIds = matchedSource.rssIds;
    if (matchedSource.journalIds) queryParams.journalIds = matchedSource.journalIds;
    if (matchedSource.keywordIds) queryParams.keywordIds = matchedSource.keywordIds;

    const result = await getUserArticles(userId, queryParams);

    const statusText = includeAll ? '所有' : '未读';
    await this.sendArticleBatch(result.articles, chatId, {
      summaryMessage: `📚 找到 ${result.articles.length} 篇来自 "${this.deps.escapeHtml(matchedSource.name)}" 的${statusText}文章：`,
      emptyMessage: `📭 来源 "${this.deps.escapeHtml(matchedSource.name)}" 没有符合条件的${statusText}文章`,
      logLabel: '/getarticles command by source',
      logContext: { sourceName: matchedSource.name },
    });
  }

  /**
   * Handle /getarticles command by keyword search
   * (fallback when source name is not found)
   */
  private async handleGetArticlesBySearch(keyword: string, chatId: string, includeAll?: boolean): Promise<void> {
    const { userId, client } = this.deps;

    const queryParams: any = {
      search: keyword,
      isRead: includeAll ? undefined : false,
      filterStatus: 'passed',
      limit: 5,
      page: 1,
      randomOrder: true,
      skipDaysFilterForSearch: true,
    };

    const result = await getUserArticles(userId, queryParams);

    const statusText = includeAll ? '所有' : '未读';
    await this.sendArticleBatch(result.articles, chatId, {
      summaryMessage: `🔍 关键词 "${this.deps.escapeHtml(keyword)}" 找到 ${result.articles.length} 篇${statusText}文章：`,
      emptyMessage: `📭 关键词 "${this.deps.escapeHtml(keyword)}" 没有找到符合条件的${statusText}文章`,
      logLabel: '/getarticles command by keyword search',
      logContext: { keyword },
    });
  }

  /**
   * Send a batch of articles to a chat.
   * Handles formatting, keyboard creation, rate limiting, and error isolation.
   */
  private async sendArticleBatch(
    articles: any[],
    chatId: string,
    options: {
      summaryMessage: string;
      emptyMessage: string;
      logLabel: string;
      logContext?: Record<string, any>;
    }
  ): Promise<void> {
    const { client, userId } = this.deps;

    if (articles.length === 0) {
      await client.sendMessage(chatId, options.emptyMessage);
      return;
    }

    await client.sendMessage(chatId, options.summaryMessage);

    let sentCount = 0;
    let failedCount = 0;

    for (const article of articles) {
      let formattedMessage = '';

      try {
        let summary = article.summary_zh || article.summary || undefined;
        if (!summary && (article.markdown_content || article.content)) {
          summary = article.markdown_content || article.content || undefined;
          if (summary && summary.length > 500) {
            summary = summary.substring(0, 500) + '...';
          }
        }

        formattedMessage = formatNewArticle({
          id: article.id,
          title: article.title,
          url: article.url,
          sourceName: article.source_name || article.rss_source_name || article.journal_name || 'Unknown',
          sourceType: article.source_origin === 'journal' ? '期刊文章' :
                      article.source_origin === 'keyword' ? '关键词订阅' :
                      article.source_origin === 'email' ? '邮件订阅' : 'RSS订阅',
          summary,
          aiSummary: this.deps.getTelegramAiSummary(article.ai_summary),
        });

        const keyboard = createArticleKeyboard(
          article.id,
          article.is_read === 1,
          article.rating
        );

        await client.sendMessageWithKeyboard(chatId, formattedMessage, keyboard, 'HTML');
        sentCount++;

        // Rate limiting: 1 second between messages
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        failedCount++;
        log.error({
          error: serializeError(error),
          articleId: article.id,
          title: article.title,
          chatId,
          parseMode: 'HTML',
          messageLength: formattedMessage.length,
          ...options.logContext,
        }, `Failed to send article via ${options.logLabel}`);
      }
    }

    log.info({
      userId,
      sentCount,
      failedCount,
      chatId,
      ...options.logContext,
    }, `Sent articles via ${options.logLabel}`);

    if (failedCount > 0) {
      await client.sendMessage(chatId,
        `⚠️ ${failedCount} 篇文章发送失败，请查看日志了解详情`);
    }
  }
}
