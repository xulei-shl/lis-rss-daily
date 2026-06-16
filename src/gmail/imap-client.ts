import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from '../logger.js';
import type { ParsedEmail } from './types.js';

const log = logger.child({ module: 'gmail-imap' });

function buildSearchQuery(senders: string[], sinceDate: Date): Record<string, any> {
  const query: Record<string, any> = { since: sinceDate };
  if (senders.length === 1) {
    query.from = senders[0];
  } else if (senders.length > 1) {
    query.or = senders.map((s) => ({ from: s }));
  }
  return query;
}

export async function fetchEmails(
  email: string,
  password: string,
  targetSenders: string[],
  lookbackHours: number,
  maxEmails: number,
  proxyUrl?: string
): Promise<ParsedEmail[]> {
  const sinceDate = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

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
      const searchQuery = buildSearchQuery(targetSenders, sinceDate);
      const uids: number[] = [];
      for await (const msg of client.fetch(searchQuery, { uid: true })) {
        uids.push(msg.uid);
      }
      log.info({ email, found: uids.length }, 'Emails found');

      const take = uids.slice(0, maxEmails);
      if (take.length === 0) return [];

      const parsed: ParsedEmail[] = [];
      const uidSeq = take.join(',');
      for await (const msg of client.fetch({ uid: uidSeq }, { source: true })) {
        if (!msg.source) continue;
        try {
          const mail = await simpleParser(msg.source as Buffer);
          parsed.push({
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
}

export async function markAndDeleteAll(
  email: string,
  password: string,
  proxyUrl?: string
): Promise<void> {
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
      const uids: number[] = [];
      for await (const msg of client.fetch({ uid: '1:*' }, { uid: true })) {
        uids.push(msg.uid);
      }
      if (uids.length > 0) {
        const uidSeq = uids.join(',');
        await client.messageFlagsAdd({ uid: uidSeq }, ['\\Deleted']);
        await client.mailboxClose();
        log.info({ email, deleted: uids.length }, 'Emails deleted from INBOX');
      }
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch { }
  }
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
