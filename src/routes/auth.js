'use strict';

const { db: coreDb } = require('../db/core');
const { hashPassword, verifyPassword } = require('../auth/password');
const { createSession, deleteSession, deleteOtherSessions } = require('../auth/session');
const { extractToken } = require('../auth/middleware');

// Precomputed once so a login attempt against a non-existent user still pays
// the same hashing cost as a real one, avoiding timing-based user enumeration.
let dummyHashPromise = null;

async function authRoutes(app) {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { login, password } = request.body || {};
      if (!login || !password) {
        reply.code(400);
        return { error: 'Identifiant et mot de passe requis.' };
      }
      const user = coreDb.prepare('SELECT * FROM users WHERE login = ? AND is_active = 1').get(String(login).trim());
      if (!dummyHashPromise) dummyHashPromise = hashPassword('capbudget-dummy-timing-guard');
      const ok = user
        ? await verifyPassword(user.password_hash, password)
        : await verifyPassword(await dummyHashPromise, password);
      if (!user || !ok) {
        reply.code(401);
        return { error: 'Identifiants invalides.' };
      }
      coreDb.prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(user.id);
      const token = createSession(user.id);
      return {
        token,
        user: {
          id: user.id,
          login: user.login,
          role: user.role,
          themePreference: user.theme_preference
        }
      };
    }
  );

  app.post('/api/auth/logout', async (request) => {
    const token = extractToken(request);
    if (token) deleteSession(token);
    return { ok: true };
  });

  app.get('/api/me', async (request) => {
    const user = coreDb.prepare(
      'SELECT id, login, role, theme_preference, last_login_at FROM users WHERE id = ?'
    ).get(request.user.id);
    let households = [];
    if (user.role === 'MEMBER') {
      households = coreDb.prepare(`
        SELECT h.id, h.name, h.currency_code
        FROM households h
        JOIN household_memberships hm ON hm.household_id = h.id
        WHERE hm.user_id = ? AND h.is_active = 1
        ORDER BY h.name
      `).all(user.id);
    }
    return {
      id: user.id,
      login: user.login,
      role: user.role,
      themePreference: user.theme_preference,
      lastLoginAt: user.last_login_at,
      households
    };
  });

  app.put('/api/me/theme', async (request, reply) => {
    const { theme } = request.body || {};
    const valid = ['SYSTEM', 'LIGHT', 'DARK', 'HIGH_CONTRAST'];
    if (!valid.includes(theme)) {
      reply.code(400);
      return { error: 'Thème invalide.' };
    }
    coreDb.prepare('UPDATE users SET theme_preference = ? WHERE id = ?').run(theme, request.user.id);
    return { ok: true };
  });

  app.put('/api/me/password', async (request, reply) => {
    const { currentPassword, newPassword } = request.body || {};
    if (!currentPassword || !newPassword || String(newPassword).length < 8) {
      reply.code(400);
      return { error: 'Mot de passe actuel requis, nouveau mot de passe d\'au moins 8 caractères.' };
    }
    const user = coreDb.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id);
    const ok = await verifyPassword(user.password_hash, currentPassword);
    if (!ok) {
      reply.code(401);
      return { error: 'Mot de passe actuel incorrect.' };
    }
    const newHash = await hashPassword(newPassword);
    coreDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
    const currentToken = extractToken(request);
    deleteOtherSessions(user.id, currentToken);
    return { ok: true };
  });

  app.post('/api/me/sessions/revoke-others', async (request) => {
    const currentToken = extractToken(request);
    deleteOtherSessions(request.user.id, currentToken);
    return { ok: true };
  });
}

module.exports = authRoutes;
