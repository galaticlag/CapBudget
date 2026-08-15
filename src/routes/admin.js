'use strict';

const { db: coreDb } = require('../db/core');
const { hashPassword } = require('../auth/password');
const { newId } = require('../util/ids');
const { logGlobalAudit } = require('../services/auditService');
const { requireAdmin } = require('../auth/middleware');
const { createHouseholdDatabase, deleteHouseholdDatabase } = require('../db/household');
const { seedHouseholdDatabase } = require('../services/seedService');

async function adminRoutes(app) {
  app.addHook('preHandler', async (request, reply) => {
    if (!request.raw.url.startsWith('/api/admin/') && !request.raw.url.startsWith('/api/households')) return;
    return requireAdmin(request, reply);
  });

  app.get('/api/admin/users', async () => {
    const users = coreDb.prepare(
      "SELECT id, login, role, is_active, created_at, last_login_at FROM users ORDER BY created_at"
    ).all();
    const memberships = coreDb.prepare(`
      SELECT hm.user_id, h.id AS household_id, h.name AS household_name
      FROM household_memberships hm JOIN households h ON h.id = hm.household_id
    `).all();
    const byUser = new Map();
    for (const m of memberships) {
      if (!byUser.has(m.user_id)) byUser.set(m.user_id, []);
      byUser.get(m.user_id).push({ id: m.household_id, name: m.household_name });
    }
    return users.map((u) => ({ ...u, households: byUser.get(u.id) || [] }));
  });

  app.post('/api/admin/users', async (request, reply) => {
    const { login, password, role, householdIds } = request.body || {};
    if (!login || !String(login).trim() || !password || String(password).length < 8) {
      reply.code(400);
      return { error: 'Identifiant requis, mot de passe d\'au moins 8 caractères.' };
    }
    if (!['ADMIN', 'MEMBER'].includes(role)) {
      reply.code(400);
      return { error: 'Rôle invalide.' };
    }
    if (role === 'ADMIN' && Array.isArray(householdIds) && householdIds.length > 0) {
      reply.code(400);
      return { error: 'Un administrateur ne peut pas être associé à un foyer.' };
    }
    if (role === 'MEMBER' && (!Array.isArray(householdIds) || householdIds.length === 0)) {
      reply.code(400);
      return { error: 'Un membre doit être associé à au moins un foyer actif.' };
    }
    const existing = coreDb.prepare('SELECT id FROM users WHERE login = ?').get(String(login).trim());
    if (existing) {
      reply.code(409);
      return { error: 'Cet identifiant existe déjà.' };
    }
    if (role === 'MEMBER') {
      for (const hid of householdIds) {
        const household = coreDb.prepare('SELECT id FROM households WHERE id = ? AND is_active = 1').get(hid);
        if (!household) {
          reply.code(400);
          return { error: 'Foyer invalide.' };
        }
      }
    }
    const id = newId('user');
    const passwordHash = await hashPassword(password);
    coreDb.prepare(`
      INSERT INTO users (id, login, password_hash, role, theme_preference, is_active)
      VALUES (?, ?, ?, ?, 'SYSTEM', 1)
    `).run(id, String(login).trim(), passwordHash, role);
    if (role === 'MEMBER') {
      const insertMembership = coreDb.prepare(`
        INSERT INTO household_memberships (household_id, user_id, created_by_admin_id) VALUES (?, ?, ?)
      `);
      for (const hid of householdIds) insertMembership.run(hid, id, request.user.id);
    }
    logGlobalAudit(request.user.id, 'CREATE', 'user', id, null, { login, role });
    reply.code(201);
    return { id };
  });

  app.put('/api/admin/users/:id', async (request, reply) => {
    const { id } = request.params;
    const { isActive } = request.body || {};
    const user = coreDb.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) {
      reply.code(404);
      return { error: 'Utilisateur introuvable.' };
    }
    if (typeof isActive === 'boolean') {
      if (!isActive && user.role === 'MEMBER') {
        const memberships = coreDb.prepare('SELECT household_id FROM household_memberships WHERE user_id = ?').all(id);
        for (const m of memberships) {
          const { n } = coreDb.prepare(`
            SELECT COUNT(*) AS n FROM household_memberships hm
            JOIN users u ON u.id = hm.user_id
            WHERE hm.household_id = ? AND u.is_active = 1 AND u.id != ?
          `).get(m.household_id, id);
          if (n === 0) {
            reply.code(409);
            return { error: 'Un foyer doit conserver au moins un membre actif.' };
          }
        }
      }
      coreDb.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
      logGlobalAudit(request.user.id, 'UPDATE', 'user', id, { isActive: Boolean(user.is_active) }, { isActive });
    }
    return { ok: true };
  });

  app.post('/api/admin/users/:id/memberships', async (request, reply) => {
    const { id } = request.params;
    const { householdId } = request.body || {};
    const user = coreDb.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user || user.role !== 'MEMBER') {
      reply.code(400);
      return { error: 'Utilisateur invalide.' };
    }
    const household = coreDb.prepare('SELECT id FROM households WHERE id = ? AND is_active = 1').get(householdId);
    if (!household) {
      reply.code(400);
      return { error: 'Foyer invalide.' };
    }
    coreDb.prepare(`
      INSERT OR IGNORE INTO household_memberships (household_id, user_id, created_by_admin_id) VALUES (?, ?, ?)
    `).run(householdId, id, request.user.id);
    logGlobalAudit(request.user.id, 'CREATE', 'membership', `${householdId}:${id}`, null, { householdId, userId: id });
    return { ok: true };
  });

  app.delete('/api/admin/users/:id/memberships/:householdId', async (request, reply) => {
    const { id, householdId } = request.params;
    const { n } = coreDb.prepare(`
      SELECT COUNT(*) AS n FROM household_memberships hm
      JOIN users u ON u.id = hm.user_id
      WHERE hm.household_id = ? AND u.is_active = 1 AND u.id != ?
    `).get(householdId, id);
    if (n === 0) {
      reply.code(409);
      return { error: 'Un foyer doit conserver au moins un membre actif.' };
    }
    coreDb.prepare('DELETE FROM household_memberships WHERE household_id = ? AND user_id = ?').run(householdId, id);
    logGlobalAudit(request.user.id, 'DELETE', 'membership', `${householdId}:${id}`, { householdId, userId: id }, null);
    return { ok: true };
  });

  app.get('/api/households', async () => {
    return coreDb.prepare('SELECT id, name, currency_code, is_active, created_at FROM households ORDER BY name').all();
  });

  app.post('/api/households', async (request, reply) => {
    const { name, currencyCode } = request.body || {};
    if (!name || !String(name).trim()) {
      reply.code(400);
      return { error: 'Nom du foyer requis.' };
    }
    const id = newId('household');
    const databaseKey = newId('hh');
    coreDb.prepare(`
      INSERT INTO households (id, name, currency_code, database_key, is_active) VALUES (?, ?, ?, ?, 1)
    `).run(id, String(name).trim(), currencyCode || 'EUR', databaseKey);
    try {
      const householdDb = createHouseholdDatabase(id);
      seedHouseholdDatabase(householdDb, id);
    } catch (err) {
      deleteHouseholdDatabase(id, databaseKey);
      coreDb.prepare('DELETE FROM households WHERE id = ?').run(id);
      request.log.error(err, 'Household creation failed, rolled back');
      reply.code(500);
      return { error: "Échec de la création du foyer. Aucune donnée n'a été conservée." };
    }
    logGlobalAudit(request.user.id, 'CREATE', 'household', id, null, { name, currencyCode: currencyCode || 'EUR' });
    reply.code(201);
    return { id };
  });

  app.put('/api/households/:id', async (request, reply) => {
    const { id } = request.params;
    const { name, isActive } = request.body || {};
    const household = coreDb.prepare('SELECT * FROM households WHERE id = ?').get(id);
    if (!household) {
      reply.code(404);
      return { error: 'Foyer introuvable.' };
    }
    const nextName = name !== undefined ? String(name).trim() : household.name;
    const nextActive = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : household.is_active;
    coreDb.prepare('UPDATE households SET name = ?, is_active = ? WHERE id = ?').run(nextName, nextActive, id);
    logGlobalAudit(
      request.user.id,
      'UPDATE',
      'household',
      id,
      { name: household.name, isActive: Boolean(household.is_active) },
      { name: nextName, isActive: Boolean(nextActive) }
    );
    return { ok: true };
  });
}

module.exports = adminRoutes;
