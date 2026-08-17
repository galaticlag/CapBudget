// @ts-check
'use strict';

const { db: coreDb } = require('../db/core');
const { newId } = require('../util/ids');
const { sessionTtlMs } = require('../config');

/** @param {string} userId @returns {string} */
function createSession(userId) {
  const id = newId('session');
  coreDb.prepare('INSERT INTO sessions (id, user_id) VALUES (?, ?)').run(id, userId);
  return id;
}

// Sliding expiration: a session is valid as long as it was seen within the TTL window.
/**
 * @param {string | null | undefined} token
 * @returns {import('../types').User | null}
 */
function getSessionUser(token) {
  if (!token) return null;
  /** @type {import('../types').Session | undefined} */
  const session = /** @type {any} */ (coreDb.prepare('SELECT id, user_id, last_seen FROM sessions WHERE id = ?').get(token));
  if (!session) return null;
  const lastSeenMs = Date.parse(session.last_seen);
  if (Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs > sessionTtlMs) {
    coreDb.prepare('DELETE FROM sessions WHERE id = ?').run(token);
    return null;
  }
  /** @type {import('../types').User | undefined} */
  const user = /** @type {any} */ (coreDb.prepare(
    'SELECT id, login, role, theme_preference, is_active FROM users WHERE id = ? AND is_active = 1'
  ).get(session.user_id));
  if (!user) return null;
  coreDb.prepare("UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(token);
  return user;
}

/** @param {string} token @returns {void} */
function deleteSession(token) {
  coreDb.prepare('DELETE FROM sessions WHERE id = ?').run(token);
}

/** @param {string} userId @param {string} currentToken @returns {void} */
function deleteOtherSessions(userId, currentToken) {
  coreDb.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, currentToken);
}

/** @param {string} userId @returns {void} */
function deleteAllSessionsForUser(userId) {
  coreDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

module.exports = { createSession, getSessionUser, deleteSession, deleteOtherSessions, deleteAllSessionsForUser };
