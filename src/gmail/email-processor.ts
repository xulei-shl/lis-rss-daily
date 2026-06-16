import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { generateNormalizedTitle } from '../utils/title.js';
import { filterArticle, type FilterInput } from '../filter.js';
import { config } from '../config.js';
import { decryptAPIKey } from '../utils/crypto.js';
import { fetchEmails, markAndDeleteAll } from './imap-client.js';
import type { EmailSourceConfig, ParsedEmail, EmailFetchResult } from './types.js';

const log = logger.child({ module: 'gmail-processor' });

function getProxyUrl(): string | undefined {
  return config.httpProxy || process.env.EMAIL_PROXY_URL;
}

function getDecryptedPassword(source: EmailSourceConfig): string {
  return decryptAPIKey(source.imapPasswordEncrypted, config.llmEncryptionKey);
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
      config.gmailFetchHoursLookback,
      config.gmailMaxEmails,
      proxyUrl
    );

    let emailsNew = 0;
    const deletedIds: string[] = [];

    for (const email of emails) {
      try {
        const titleNormalized = generateNormalizedTitle(email.subject);
        const title = email.subject;

        if (titleNormalized) {
          const existing = await db
            .selectFrom('articles')
            .where('title_normalized', '=', titleNormalized)
            .select('id')
            .executeTakeFirst();

          if (existing) {
            deletedIds.push(email.messageId);
            continue;
          }
        }

        const content = email.html || email.text || '';
        const url = email.messageId;

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
        emailsNew++;

        deletedIds.push(email.messageId);

        process.nextTick(() => {
          const filterInput: FilterInput = {
            articleId: insertedId,
            userId: source.userId,
            url,
            title,
            description: content,
            sourceType: 'email',
          };
          filterArticle(filterInput).catch((err) => {
            log.warn({ articleId: insertedId, error: err }, 'Auto-filter failed for email article');
          });
        });

      } catch (err: any) {
        if (err.message && err.message.includes('UNIQUE')) {
          deletedIds.push(email.messageId);
        } else {
          log.warn({ email: email.subject, error: err.message }, 'Failed to save email');
        }
        continue;
      }
    }

    if (deletedIds.length > 0) {
      markAndDeleteAll(source.emailAddress, imapPassword, proxyUrl)
        .catch(err => log.warn({ error: err }, 'Failed to delete processed emails'));
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
        emails_new: emailsNew,
        duration_ms: Date.now() - startTime,
      } as any)
      .execute();

    log.info({ sourceId: source.id, found: emails.length, new: emailsNew }, 'Email source processed');

    return {
      sourceId: source.id,
      success: true,
      emailsFound: emails.length,
      emailsNew,
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
