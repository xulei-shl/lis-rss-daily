import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from '../logger.js';
import type { ParsedEmail } from './types.js';

const log = logger.child({ module: 'gmail-imap' });

const TLS_ERROR_MSG = 'Client network socket disconnected before secure TLS connection was established';
const MAX_RETRIES = 2;
const RETRY_DELAY_MIN = 60_000;
const RETRY_DELAY_MAX = 180_000;

function isTlsError(err: any): boolean {
  return err?.message?.includes(TLS_ERROR_MSG) === true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: any;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        log.info({ attempt, label }, `${label} succeeded after retry`);
      }
      return result;
    } catch (err: any) {
      lastErr = err;
      if (!isTlsError(err) || attempt > MAX_RETRIES) {
        log.error({ attempt, label, error: err.message }, `${label} failed after ${attempt} attempt(s)`);
        throw err;
      }
      const delay = randomDelay(RETRY_DELAY_MIN, RETRY_DELAY_MAX);
      log.warn({ attempt, delay, error: err.message }, `${label} failed, retrying...`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function buildSearchQuery(senders: string[]): Record<string, any> {
  if (senders.length === 1) {
    return { from: senders[0] };
  }
  if (senders.length > 1) {
    return { or: senders.map((s) => ({ from: s })) };
  }
  return {};
}

export async function fetchEmails(
  email: string,
  password: string,
  targetSenders: string[],
  maxEmails: number,
  proxyUrl?: string
): Promise<ParsedEmail[]> {
  return withRetry(async () => {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: email, pass: password },
      logger: false,
      connectionTimeout: 120 * 1000,
      greetingTimeout: 30 * 1000,
      ...(proxyUrl ? { proxy: proxyUrl } : {}),
    });

    try {
      await client.connect();
      log.info({ email }, 'IMAP connected');

      const lock = await client.getMailboxLock('INBOX');
      try {
        const searchQuery = buildSearchQuery(targetSenders);
        const candidates: { uid: number; date: Date }[] = [];
        for await (const msg of client.fetch(searchQuery, { uid: true, internalDate: true })) {
          candidates.push({ uid: msg.uid, date: new Date(msg.internalDate ?? 0) });
        }
        log.info({ email, found: candidates.length }, 'Emails found');

        candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
        const take = candidates.slice(0, maxEmails).map((c) => c.uid);
        if (take.length === 0) return [];

        const parsed: ParsedEmail[] = [];
        const uidSeq = take.join(',');
        for await (const msg of client.fetch({ uid: uidSeq }, { source: true })) {
          if (!msg.source) continue;
          try {
            const mail = await simpleParser(msg.source as Buffer);
            parsed.push({
              uid: msg.uid,
              messageId: mail.messageId || `${msg.uid}@unknown`,
              subject: mail.subject || '(No Subject)',
              from: (mail.from && mail.from.text) || 'unknown',
              date: mail.date || new Date(),
              html: mail.html || null,
              text: mail.text || null,
            });
          } catch (parseErr: any) {
            log.warn({ uid: msg.uid, error: parseErr.message }, 'Failed to parse email');
          }
        }
        return parsed;
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch { }
    }
  }, 'fetchEmails');
}

export async function markAndDelete(
  email: string,
  password: string,
  uids: number[],
  proxyUrl?: string
): Promise<void> {
  if (uids.length === 0) return;

  return withRetry(async () => {
    const client = new ImapFlow({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: email, pass: password },
      logger: false,
      ...(proxyUrl ? { proxy: proxyUrl } : {}),
    });

    try {
      await client.connect();

      const lock = await client.getMailboxLock('INBOX');
      try {
        const uidSeq = uids.join(',');
        await client.messageFlagsAdd({ uid: uidSeq }, ['\\Deleted']);
        await client.mailboxClose();
        log.info({ email, deleted: uids.length }, 'Emails deleted from INBOX');
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch { }
    }
  }, 'markAndDelete');
}

export async function testConnection(
  email: string,
  password: string,
  proxyUrl?: string
): Promise<{ success: boolean; error?: string }> {
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    logger: false,
    ...(proxyUrl ? { proxy: proxyUrl } : {}),
  });

  try {
    await client.connect();
    await client.logout();
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
