// @ts-check
'use strict';

const path = require('node:path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const fastifyRateLimit = require('@fastify/rate-limit');

const { appDir } = require('./src/config');
const { authenticate, requireHousehold } = require('./src/auth/middleware');

// Requiring core db first ensures schema/seed data exist before any route runs.
require('./src/db/core');

const setupRoutes = require('./src/routes/setup');
const authRoutes = require('./src/routes/auth');
const adminRoutes = require('./src/routes/admin');
const referentialsRoutes = require('./src/routes/referentials');
const rulesRoutes = require('./src/routes/rules');
const auditRoutes = require('./src/routes/audit');
const importRoutes = require('./src/routes/imports');
const transactionRoutes = require('./src/routes/transactions');
const dashboardRoutes = require('./src/routes/dashboard');
const backupRoutes = require('./src/routes/backup');

const app = Fastify({ logger: true, bodyLimit: 8 * 1024 * 1024 });

// Paths that manage their own auth/authorization (or are public) and must never
// be forced through the household-membership check below.
const HOUSEHOLD_EXEMPT_PREFIXES = [
  '/api/health',
  '/api/setup/',
  '/api/auth/',
  '/api/me',
  '/api/admin/',
  '/api/households',
  '/api/audit/global'
];

let ready = null;

async function buildApp() {
  if (ready) return ready;
  ready = (async () => {
    await app.register(fastifyRateLimit, { global: false });

    app.get('/api/health', async () => ({ ok: true }));

    // Global auth: resolves request.user (or 401/403s) for every /api/* route.
    app.addHook('preHandler', authenticate);

    // Global household scoping: every financial /api/* route must resolve a
    // membership-checked household connection; never trust a client-supplied path.
    app.addHook('preHandler', async (request, reply) => {
      const pathname = request.raw.url.split('?')[0];
      if (!pathname.startsWith('/api/')) return;
      if (HOUSEHOLD_EXEMPT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) return;
      return requireHousehold(request, reply);
    });

    await app.register(setupRoutes);
    await app.register(authRoutes);
    await app.register(adminRoutes);
    await app.register(referentialsRoutes);
    await app.register(rulesRoutes);
    await app.register(auditRoutes);
    await app.register(importRoutes);
    await app.register(transactionRoutes);
    await app.register(dashboardRoutes);
    await app.register(backupRoutes);

    await app.register(fastifyStatic, {
      root: path.join(appDir, 'public')
    });

    // SPA fallback: any non-API, non-file route serves index.html so client-side
    // routing (hash-based) works on refresh/direct navigation.
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'Route API introuvable.' });
        return;
      }
      reply.sendFile('index.html');
    });
  })();
  return ready;
}

async function start() {
  await buildApp();
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen({ port, host });
}

module.exports = { app, buildApp, start };

if (require.main === module) {
  // Without these, an uncaught exception/rejection kills the process silently
  // (stack trace only goes to stderr, which isn't captured by our logger).
  process.on('uncaughtException', (err) => {
    app.log.error({ err }, 'uncaughtException, shutting down');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandledRejection, shutting down');
    process.exit(1);
  });

  start().catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
}
