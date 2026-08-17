// @ts-check
'use strict';

const crypto = require('node:crypto');
const { db: coreDb } = require('../db/core');

/** @returns {Buffer} */
function getOrCreateEncryptionKey() {
  /** @type {{ value: string } | undefined} */
  const row = /** @type {any} */ (coreDb.prepare('SELECT value FROM global_settings WHERE key = ?').get('account_encryption_key'));
  if (row) return Buffer.from(row.value, 'base64');
  const key = crypto.randomBytes(32);
  coreDb.prepare('INSERT INTO global_settings (key, value) VALUES (?, ?)').run(
    'account_encryption_key',
    key.toString('base64')
  );
  return key;
}

// Lazily resolved so core.js has finished creating global_settings first.
/** @type {Buffer | null} */
let cachedKey = null;
/** @returns {Buffer} */
function key() {
  if (!cachedKey) cachedKey = getOrCreateEncryptionKey();
  return cachedKey;
}

/** @param {string} plainText @returns {string} */
function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/** @param {string} encoded @returns {string} */
function decrypt(encoded) {
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** @param {string} reference @returns {string} */
function mask(reference) {
  const raw = String(reference || '');
  if (raw.length <= 4) return '*'.repeat(raw.length);
  return `${'*'.repeat(raw.length - 4)}${raw.slice(-4)}`;
}

// Deterministic (but non-reversible) lookup key so accounts can be matched during
// re-import without decrypting every stored reference or storing it in plaintext.
/** @param {string} reference @returns {string} */
function lookupHash(reference) {
  const hmacKey = crypto.createHash('sha256').update(Buffer.concat([key(), Buffer.from(':lookup-hmac')])).digest();
  return crypto.createHmac('sha256', hmacKey).update(String(reference || '')).digest('hex');
}

module.exports = { encrypt, decrypt, mask, lookupHash };
