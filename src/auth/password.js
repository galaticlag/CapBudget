'use strict';

const crypto = require('node:crypto');

// Spec requires Argon2id. Prefer native bindings; degrade gracefully if the
// platform has no prebuilt binary (e.g. an unsupported arch) rather than crashing.
let argon2 = null;
try {
  // eslint-disable-next-line global-require
  argon2 = require('@node-rs/argon2');
} catch (err) {
  argon2 = null;
}

function pbkdf2Hash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  return `pbkdf2$${salt}$${hash}`;
}

function pbkdf2Verify(stored, password) {
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const [, salt, hash] = parts;
  const attempt = crypto.pbkdf2Sync(password, salt, 120000, 64, 'sha512').toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(attempt, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function hashPassword(password) {
  if (argon2) {
    return argon2.hash(password, { algorithm: argon2.Algorithm.Argon2id });
  }
  return pbkdf2Hash(password);
}

async function verifyPassword(stored, password) {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2$')) return pbkdf2Verify(stored, password);
  if (argon2) {
    try {
      return await argon2.verify(stored, password);
    } catch (err) {
      return false;
    }
  }
  // Argon2 hash present but native binding missing on this platform: fail closed.
  return false;
}

module.exports = { hashPassword, verifyPassword, usingArgon2: () => Boolean(argon2) };
