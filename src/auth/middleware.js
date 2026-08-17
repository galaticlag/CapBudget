// @ts-check
'use strict';

const { db: coreDb } = require('../db/core');
const { getSessionUser } = require('./session');
const { getHouseholdDb } = require('../db/household');

function extractToken(request) {
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return request.headers['x-session-token'] || null;
}

// Global hook: resolves request.user from the session token for every /api/* route
// except the small explicit allowlist of public endpoints (login, first-run setup, health).
const PUBLIC_PATHS = new Set(['/api/health', '/api/setup/status', '/api/setup/admin', '/api/auth/login']);

async function authenticate(request, reply) {
  if (!request.raw.url.startsWith('/api/')) return;
  const pathname = request.raw.url.split('?')[0];
  if (PUBLIC_PATHS.has(pathname)) return;

  const token = extractToken(request);
  const user = getSessionUser(token);
  if (!user) {
    reply.code(401).send({ error: 'Authentification requise.' });
    return reply;
  }
  request.user = user;

  // Spec: ADMIN is a technical account with zero access to household financial data.
  const adminAllowlist = ['/api/auth/', '/api/me', '/api/admin/', '/api/households', '/api/audit/global'];
  if (user.role === 'ADMIN' && !adminAllowlist.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    reply.code(403).send({ error: "L'administrateur n'a pas accès aux données financières d'un foyer." });
    return reply;
  }
}

// Route-level preHandler for every household-scoped financial endpoint.
// Verifies MEMBER <-> household association server-side on every request.
async function requireHousehold(request, reply) {
  if (request.user.role !== 'MEMBER') {
    reply.code(403).send({ error: 'Accès réservé aux membres d\'un foyer.' });
    return reply;
  }
  const householdId = request.query.householdId || request.headers['x-household-id'];
  if (!householdId) {
    reply.code(400).send({ error: 'Paramètre householdId requis.' });
    return reply;
  }
  const membership = coreDb.prepare(
    'SELECT 1 FROM household_memberships WHERE household_id = ? AND user_id = ?'
  ).get(householdId, request.user.id);
  if (!membership) {
    reply.code(403).send({ error: "Vous n'êtes pas associé à ce foyer." });
    return reply;
  }
  const household = coreDb.prepare('SELECT * FROM households WHERE id = ? AND is_active = 1').get(householdId);
  if (!household) {
    reply.code(404).send({ error: 'Foyer introuvable ou archivé.' });
    return reply;
  }
  const householdDb = getHouseholdDb(householdId);
  if (!householdDb) {
    reply.code(500).send({ error: 'Base de données du foyer indisponible.' });
    return reply;
  }
  request.householdId = householdId;
  request.household = household;
  request.householdDb = householdDb;
}

async function requireAdmin(request, reply) {
  if (request.user.role !== 'ADMIN') {
    reply.code(403).send({ error: 'Accès réservé aux administrateurs.' });
    return reply;
  }
}

module.exports = { authenticate, requireHousehold, requireAdmin, extractToken };
