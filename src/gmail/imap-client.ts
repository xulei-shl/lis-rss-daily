import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logger } from '../logger.js';
import type { ParsedEmail } from './types.js';

const log = logger.child({ module: 'gmail-imap' });

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
      const uids: number[] = [];
      for await (const msg of client.fetch(searchQuery, { uid: true })) {
        uids.push(msg.uid);
      }
      log.info({ email, found: uids.length }, 'Emails found');

      const take = uids.slice(-maxEmails);
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
}

export async function markAndDelete(
  email: string,
  password: string,
  uids: number[],
  proxyUrl?: string
): Promise<void> {
  if (uids.length === 0) return;

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
