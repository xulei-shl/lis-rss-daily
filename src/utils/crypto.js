"use strict";
/**
 * Crypto Utilities
 *
 * Encryption and decryption utilities for sensitive data like API keys.
 * Uses AES-256-GCM encryption algorithm.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptAPIKey = encryptAPIKey;
exports.decryptAPIKey = decryptAPIKey;
exports.generateEncryptionKey = generateEncryptionKey;
exports.isValidEncryptionKey = isValidEncryptionKey;
var crypto_1 = require("crypto");
var logger_js_1 = require("../logger.js");
var log = logger_js_1.logger.child({ module: 'crypto' });
var ALGORITHM = 'aes-256-gcm';
var KEY_LENGTH = 32;
var IV_LENGTH = 16;
var TAG_LENGTH = 16;
var TAG_POSITION = IV_LENGTH + TAG_LENGTH;
/**
 * Encrypt an API key using AES-256-GCM
 * @param text - Plain text to encrypt
 * @param encryptionKey - Hex-encoded encryption key (64 hex chars = 32 bytes)
 * @returns Base64-encoded encrypted data (IV + Tag + Ciphertext)
 */
function encryptAPIKey(text, encryptionKey) {
    try {
        var key = Buffer.from(encryptionKey, 'hex');
        if (key.length !== KEY_LENGTH) {
            throw new Error("Encryption key must be ".concat(KEY_LENGTH, " bytes (64 hex chars), got ").concat(key.length));
        }
        var iv = crypto_1.default.randomBytes(IV_LENGTH);
        var cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
        var encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        var tag = cipher.getAuthTag();
        // Format: IV (16) + Tag (16) + Encrypted (variable)
        var result = Buffer.concat([iv, tag, encrypted]).toString('base64');
        log.debug({ length: text.length }, 'API key encrypted');
        return result;
    }
    catch (error) {
        log.error({ error: error }, 'Failed to encrypt API key');
        throw new Error('Failed to encrypt API key');
    }
}
/**
 * Decrypt an API key using AES-256-GCM
 * @param encryptedText - Base64-encoded encrypted data (IV + Tag + Ciphertext)
 * @param encryptionKey - Hex-encoded encryption key (64 hex chars = 32 bytes)
 * @returns Decrypted plain text
 */
function decryptAPIKey(encryptedText, encryptionKey) {
    try {
        var key = Buffer.from(encryptionKey, 'hex');
        if (key.length !== KEY_LENGTH) {
            throw new Error("Encryption key must be ".concat(KEY_LENGTH, " bytes (64 hex chars), got ").concat(key.length));
        }
        var buffer = Buffer.from(encryptedText, 'base64');
        if (buffer.length < IV_LENGTH + TAG_LENGTH) {
            throw new Error('Invalid encrypted data: too short');
        }
        var iv = buffer.subarray(0, IV_LENGTH);
        var tag = buffer.subarray(IV_LENGTH, TAG_POSITION);
        var encrypted = buffer.subarray(TAG_POSITION);
        var decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        var decrypted = decipher.update(encrypted) + decipher.final('utf8');
        log.debug({ length: decrypted.length }, 'API key decrypted');
        return decrypted;
    }
    catch (error) {
        log.error({ error: error }, 'Failed to decrypt API key');
        throw new Error('Failed to decrypt API key');
    }
}
/**
 * Generate a random encryption key
 * @returns Hex-encoded 32-byte key (64 hex characters)
 */
function generateEncryptionKey() {
    return crypto_1.default.randomBytes(KEY_LENGTH).toString('hex');
}
/**
 * Validate an encryption key format
 * @param key - Hex-encoded key to validate
 * @returns true if valid, false otherwise
 */
function isValidEncryptionKey(key) {
    try {
        var buffer = Buffer.from(key, 'hex');
        return buffer.length === KEY_LENGTH && /^[0-9a-fA-F]{64}$/.test(key);
    }
    catch (_a) {
        return false;
    }
}
