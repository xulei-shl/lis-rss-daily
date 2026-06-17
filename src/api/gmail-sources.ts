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
}

export interface UpdateEmailSourceInput {
  name?: string;
  emailAddress?: string;
  imapPassword?: string;
  targetSenders?: string[];
  status?: 'active' | 'inactive';
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

  const result = await db
    .insertInto('email_sources')
    .values({
      user_id: userId,
      name: input.name,
      email_address: input.emailAddress,
      imap_password_encrypted: encrypted,
      target_senders: JSON.stringify(input.targetSenders),
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
