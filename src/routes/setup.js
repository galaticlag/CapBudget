'use strict';

const { db: coreDb } = require('../db/core');
const { hashPassword } = require('../auth/password');
const { newId } = require('../util/ids');
const { logGlobalAudit } = require('../services/auditService');

async function setupRoutes(app) {
  app.get('/api/setup/status', async () => {
    const { n } = coreDb.prepare('SELECT COUNT(*) AS n FROM users').get();
    return { needsSetup: n === 0 };
  });

  app.post('/api/setup/admin', async (request, reply) => {
    const { n } = coreDb.prepare('SELECT COUNT(*) AS n FROM users').get();
    if (n > 0) {
      reply.code(403);
      return { error: 'Un compte existe déjà. Le premier démarrage est terminé.' };
    }
    const { login, password } = request.body || {};
    if (!login || !String(login).trim() || !password || String(password).length < 8) {
      reply.code(400);
      return { error: 'Identifiant requis et mot de passe d\'au moins 8 caractères.' };
    }
    const id = newId('user');
    const passwordHash = await hashPassword(password);
    coreDb.prepare(`
      INSERT INTO users (id, login, password_hash, role, theme_preference, is_active)
      VALUES (?, ?, ?, 'ADMIN', 'SYSTEM', 1)
    `).run(id, String(login).trim(), passwordHash);
    logGlobalAudit(id, 'CREATE', 'user', id, null, { login, role: 'ADMIN', via: 'first-run-setup' });
    return { ok: true };
  });
}

module.exports = setupRoutes;
