/**
 * Crypto Utilities
 *
 * Encryption and decryption utilities for sensitive data like API keys.
 * Uses AES-256-GCM encryption algorithm.
 */

import crypto from 'crypto';
import { logger } from '../logger.js';

const log = logger.child({ module: 'crypto' });

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const TAG_POSITION = IV_LENGTH + TAG_LENGTH;

/**
 * Encrypt an API key using AES-256-GCM
 * @param text - Plain text to encrypt
 * @param encryptionKey - Hex-encoded encryption key (64 hex chars = 32 bytes)
 * @returns Base64-encoded encrypted data (IV + Tag + Ciphertext)
 */
export function encryptAPIKey(text: string, encryptionKey: string): string {
  try {
    const key = Buffer.from(encryptionKey, 'hex');

    if (key.length !== KEY_LENGTH) {
      throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (64 hex chars), got ${key.length}`);
    }

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: IV (16) + Tag (16) + Encrypted (variable)
    const result = Buffer.concat([iv, tag, encrypted]).toString('base64');

    log.debug({ length: text.length }, 'API key encrypted');

    return result;
  } catch (error) {
    log.error({ error }, 'Failed to encrypt API key');
    throw new Error('Failed to encrypt API key');
  }
}

/**
 * Decrypt an API key using AES-256-GCM
 * @param encryptedText - Base64-encoded encrypted data (IV + Tag + Ciphertext)
 * @param encryptionKey - Hex-encoded encryption key (64 hex chars = 32 bytes)
 * @returns Decrypted plain text
 */
export function decryptAPIKey(encryptedText: string, encryptionKey: string): string {
  try {
    const key = Buffer.from(encryptionKey, 'hex');

    if (key.length !== KEY_LENGTH) {
      throw new Error(`Encryption key must be ${KEY_LENGTH} bytes (64 hex chars), got ${key.length}`);
    }

    const buffer = Buffer.from(encryptedText, 'base64');

    if (buffer.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid encrypted data: too short');
    }

    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, TAG_POSITION);
    const encrypted = buffer.subarray(TAG_POSITION);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = decipher.update(encrypted) + decipher.final('utf8');

    log.debug({ length: decrypted.length }, 'API key decrypted');

    return decrypted;
  } catch (error) {
    log.error({ error }, 'Failed to decrypt API key');
    throw new Error('Failed to decrypt API key');
  }
}

/**
 * Generate a random encryption key
 * @returns Hex-encoded 32-byte key (64 hex characters)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Validate an encryption key format
 * @param key - Hex-encoded key to validate
 * @returns true if valid, false otherwise
 */
export function isValidEncryptionKey(key: string): boolean {
  try {
    const buffer = Buffer.from(key, 'hex');
    return buffer.length === KEY_LENGTH && /^[0-9a-fA-F]{64}$/.test(key);
  } catch {
    return false;
  }
}
