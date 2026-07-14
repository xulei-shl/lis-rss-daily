import { getDb } from '../db.js';
import { logger } from '../logger.js';
import { encryptAPIKey } from '../utils/crypto.js';
import { config } from '../config.js';
import { testConnection } from '../gmail/imap-client.js';

const log = logger.child({ module: 'gmail-sources-service' });

export interface CreateEmailSourceInput {
  name: string;
  emailAddress: string;
  imapPassword: string;
  targetSenders: string[];
  status?: 'active' | 'inactive';
  domainId?: number;
  autoCleanupRejected?: boolean;
}

export interface UpdateEmailSourceInput {
  name?: string;
  emailAddress?: string;
  imapPassword?: string;
  targetSenders?: string[];
  status?: 'active' | 'inactive';
  domainId?: number;
  autoCleanupRejected?: boolean;
}

function encryptPassword(password: string): string {
  return encryptAPIKey(password, config.llmEncryptionKey);
}

export async function getEmailSources(userId: number) {
  const db = getDb();
  return db
    .selectFrom('email_sources')
    .where('user_id', '=', userId)
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();
}

export async function getEmailSourceById(id: number, userId: number) {
  const db = getDb();
  return db
    .selectFrom('email_sources')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst();
}

export async function createEmailSource(userId: number, input: CreateEmailSourceInput) {
  const db = getDb();
  const encrypted = encryptPassword(input.imapPassword);

  // 如果未指定 domain_id，使用用户优先级最高的活跃领域
  let domainId = input.domainId;
  if (domainId === undefined) {
    const defaultDomain = await db
      .selectFrom('topic_domains')
      .where('user_id', '=', userId)
      .where('is_active', '=', 1)
      .select('id')
      .orderBy('priority', 'desc')
      .executeTakeFirst();
    domainId = defaultDomain?.id;
  }

  const result = await db
    .insertInto('email_sources')
    .values({
      user_id: userId,
      name: input.name,
      email_address: input.emailAddress,
      imap_password_encrypted: encrypted,
      target_senders: JSON.stringify(input.targetSenders),
      domain_id: domainId,
      auto_cleanup_rejected: input.autoCleanupRejected ? 1 : 0,
      status: input.status || 'active',
      updated_at: new Date().toISOString(),
    } as any)
    .executeTakeFirstOrThrow();

  const insertedId = Number(result.insertId);
  log.info({ userId, id: insertedId, email: input.emailAddress }, 'Email source created');
  return { id: insertedId, name: input.name, emailAddress: input.emailAddress };
}

export async function updateEmailSource(id: number, userId: number, input: UpdateEmailSourceInput) {
  const db = getDb();
  const updateData: Record<string, any> = { updated_at: new Date().toISOString() };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.emailAddress !== undefined) updateData.email_address = input.emailAddress;
  if (input.imapPassword !== undefined) updateData.imap_password_encrypted = encryptPassword(input.imapPassword);
  if (input.targetSenders !== undefined) updateData.target_senders = JSON.stringify(input.targetSenders);
  if (input.status !== undefined) updateData.status = input.status;
  if (input.domainId !== undefined) updateData.domain_id = input.domainId;
  if (input.autoCleanupRejected !== undefined) updateData.auto_cleanup_rejected = input.autoCleanupRejected ? 1 : 0;

  const result = await db
    .updateTable('email_sources')
    .set(updateData)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows) === 0) {
    throw new Error('Email source not found');
  }

  log.info({ userId, id }, 'Email source updated');
}

export async function deleteEmailSource(id: number, userId: number) {
  const db = getDb();
  const result = await db
    .deleteFrom('email_sources')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (Number(result.numDeletedRows) === 0) {
    throw new Error('Email source not found');
  }

  log.info({ userId, id }, 'Email source deleted');
}

export async function testEmailSourceConnection(
  emailAddress: string,
  imapPassword: string
): Promise<{ success: boolean; error?: string }> {
  const proxyUrl = process.env.GMAIL_PROXY_URL || config.httpProxy || process.env.EMAIL_PROXY_URL;
  return testConnection(emailAddress, imapPassword, proxyUrl);
}
