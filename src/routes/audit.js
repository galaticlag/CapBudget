'use strict';

const { db: coreDb } = require('../db/core');
const { requireAdmin } = require('../auth/middleware');

async function auditRoutes(app) {
  app.get('/api/audit/household', async (request) => {
    const rows = request.householdDb.prepare(`
      SELECT * FROM household_audit_logs ORDER BY created_at DESC LIMIT 100
    `).all();
    return rows.map((r) => ({ ...r, old_value: r.old_value ? JSON.parse(r.old_value) : null, new_value: r.new_value ? JSON.parse(r.new_value) : null }));
  });

  app.get('/api/audit/global', { preHandler: requireAdmin }, async () => {
    const rows = coreDb.prepare(`
      SELECT g.*, u.login AS user_login FROM global_audit_logs g LEFT JOIN users u ON u.id = g.user_id
      ORDER BY g.created_at DESC LIMIT 100
    `).all();
    return rows.map((r) => ({ ...r, old_value: r.old_value ? JSON.parse(r.old_value) : null, new_value: r.new_value ? JSON.parse(r.new_value) : null }));
  });
}

module.exports = auditRoutes;
