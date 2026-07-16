import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { generateNormalizedTitle } from '../utils/title.js';
import { filterArticle, type FilterInput } from '../filter.js';
import { processArticle } from '../pipeline.js';
import { config } from '../config.js';
import { decryptAPIKey } from '../utils/crypto.js';
import { parseLLMJSON } from '../utils/llm-json-parser.js';
import { fetchEmails, markAndDelete } from './imap-client.js';
import { getUserLLMProvider, type ChatMessage } from '../llm.js';
import { buildPromptVariables } from '../api/prompt-variable-builder.js';
import { resolveSystemPrompt } from '../api/system-prompts.js';
import type { EmailSourceConfig, ParsedEmail, EmailFetchResult } from './types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_EMAIL_PARSE_PROMPT_PATH = path.join(__dirname, '../config/default-prompts/email_parse.md');

function readDefaultEmailParsePrompt(): string {
  try {
    return fs.readFileSync(DEFAULT_EMAIL_PARSE_PROMPT_PATH, 'utf-8');
  } catch {
    return '';
  }
}

const log = logger.child({ module: 'gmail-processor' });

interface ParsedArticle {
  title: string;
  summary?: string;
  content?: string;
  url?: string;
  author?: string;
}

interface EmailParseResult {
  articles: ParsedArticle[];
}

function getProxyUrl(): string | undefined {
  return process.env.GMAIL_PROXY_URL || config.httpProxy || process.env.EMAIL_PROXY_URL;
}

function getDecryptedPassword(source: EmailSourceConfig): string {
  return decryptAPIKey(source.imapPasswordEncrypted, config.llmEncryptionKey).replace(/\s+/g, '');
}

async function parseEmailContent(email: ParsedEmail, userId: number): Promise<ParsedArticle[]> {
  try {
    const content = email.text || email.html || '';
    if (!content) return [];

    const variables = await buildPromptVariables({
      type: 'email_parse',
      userId,
      email: {
        subject: email.subject,
        content: content.substring(0, 30000),
        from: email.from,
      },
    });

    const defaultTemplate = readDefaultEmailParsePrompt();
    let userPrompt = await resolveSystemPrompt(userId, 'email_parse', defaultTemplate, variables);

    if (!userPrompt || userPrompt.trim().length === 0) {
      log.warn({ emailSubject: email.subject }, 'No email_parse prompt available, treating email as single article');
      return [{
        title: email.subject,
        content: content,
        url: email.messageId,
      }];
    }

    // 确保邮件内容始终在 prompt 中（模板可能不含 {{EMAIL_CONTENT}}）
    const emailContentForLlm = content.substring(0, 30000);
    if (!userPrompt.includes(emailContentForLlm.substring(0, 100))) {
      userPrompt += `\n\n### 邮件内容\n\n${emailContentForLlm}`;
    }

    const messages: ChatMessage[] = [
      { role: 'user', content: userPrompt },
    ];

    const llm = await getUserLLMProvider(userId, 'email_parse');
    const response = await llm.chat(messages, {
      jsonMode: true,
      temperature: 0.1,
      label: 'email-parse',
    });

    const parseResult = parseLLMJSON<EmailParseResult>(response, {
      allowPartial: true,
      maxResponseLength: 8192,
      errorPrefix: 'Email parse',
    });

    if (!parseResult.success || !parseResult.data) {
      log.warn({ emailSubject: email.subject, error: parseResult.error }, 'Failed to parse LLM email response, treating as single article');
      return [{
        title: email.subject,
        content: email.text || email.html || '',
        url: email.messageId,
      }];
    }

    const parsed = parseResult.data;
    if (!parsed.articles || !Array.isArray(parsed.articles)) {
      log.warn({ emailSubject: email.subject }, 'Invalid email parse response format');
      return [];
    }

    return parsed.articles.filter((a) => a.title && a.title.trim());
  } catch (err: any) {
    log.warn({ emailSubject: email.subject, error: err.message }, 'Failed to parse email content, treating as single article');
    return [{
      title: email.subject,
      content: email.text || email.html || '',
      url: email.messageId,
    }];
  }
}

export async function processEmailSource(source: EmailSourceConfig): Promise<EmailFetchResult> {
  const db = getDb();
  const startTime = Date.now();
  const proxyUrl = getProxyUrl();

  try {
    const imapPassword = getDecryptedPassword(source);
    const emails = await fetchEmails(
      source.emailAddress,
      imapPassword,
      source.targetSenders,
      config.gmailMaxEmails,
      proxyUrl
    );

    let articlesNew = 0;
    const deletedUids: number[] = [];

    for (const email of [...emails].reverse()) {
      try {
        const parsedArticles = await parseEmailContent(email, source.userId);

        for (const article of parsedArticles) {
          try {
            const titleNormalized = generateNormalizedTitle(article.title);
            const title = article.title;

            if (titleNormalized) {
              const existing = await db
                .selectFrom('articles')
                .where('title_normalized', '=', titleNormalized)
                .select('id')
                .executeTakeFirst();

              if (existing) continue;

              // Also check rejected_articles archive (articles cleaned up by auto-cleanup)
              const rejectedExists = await db
                .selectFrom('rejected_articles')
                .where('title_normalized', '=', titleNormalized)
                .select('id')
                .executeTakeFirst();

              if (rejectedExists) continue;
            }

            const content = article.content || email.html || email.text || '';
            const url = article.url || email.messageId;

            const articleId = await db
              .insertInto('articles')
              .values({
                email_source_id: source.id,
                title,
                title_normalized: titleNormalized,
                url,
                content,
                source_origin: 'email',
                filter_status: 'pending',
                process_status: 'pending',
                published_at: email.date.toISOString(),
                is_read: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as any)
              .executeTakeFirstOrThrow();

            const insertedId = Number(articleId.insertId);
            articlesNew++;

            process.nextTick(async () => {
              try {
                const filterInput: FilterInput = {
                  articleId: insertedId,
                  userId: source.userId,
                  url,
                  title,
                  description: article.summary || content,
                  sourceType: 'email',
                  sourceDomainId: source.domainId,
                };
                const filterResult = await filterArticle(filterInput);
                if (filterResult.passed) {
                  await processArticle(insertedId, source.userId);
                }
              } catch (err: any) {
                log.warn({ articleId: insertedId, error: err.message }, 'Auto-filter/process failed for email article');
              }
            });

          } catch (err: any) {
            if (err.message && err.message.includes('UNIQUE')) {
              continue;
            }
            log.warn({ title: article.title, error: err.message }, 'Failed to save parsed article');
          }
        }

        deletedUids.push(email.uid);
      } catch (err: any) {
        log.warn({ email: email.subject, error: err.message }, 'Failed to process email');
      }
    }

    if (deletedUids.length > 0) {
      try {
        await markAndDelete(source.emailAddress, imapPassword, deletedUids, proxyUrl);
      } catch (err: any) {
        log.warn({ error: err.message }, 'Failed to delete processed emails');
      }
    }

    await db
      .updateTable('email_sources')
      .set({ last_fetched_at: new Date().toISOString(), last_error: null })
      .where('id', '=', source.id)
      .execute();

    await db
      .insertInto('email_fetch_logs')
      .values({
        email_source_id: source.id,
        status: 'success',
        emails_found: emails.length,
        emails_new: articlesNew,
        duration_ms: Date.now() - startTime,
      } as any)
      .execute();

    log.info({ sourceId: source.id, found: emails.length, new: articlesNew }, 'Email source processed');

    return {
      sourceId: source.id,
      success: true,
      emailsFound: emails.length,
      emailsNew: articlesNew,
      duration: Date.now() - startTime,
    };

  } catch (err: any) {
    const duration = Date.now() - startTime;

    await db
      .updateTable('email_sources')
      .set({ last_error: err.message, last_fetched_at: new Date().toISOString() })
      .where('id', '=', source.id)
      .execute();

    await db
      .insertInto('email_fetch_logs')
      .values({
        email_source_id: source.id,
        status: 'failed',
        emails_found: 0,
        emails_new: 0,
        error_message: err.message,
        duration_ms: duration,
      } as any)
      .execute();

    log.error({ sourceId: source.id, error: err.message }, 'Email source processing failed');

    return {
      sourceId: source.id,
      success: false,
      emailsFound: 0,
      emailsNew: 0,
      error: err.message,
      duration,
    };
  }
}
