// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { householdsDir, backupsDir, maxRestoreBytes } = require('../config');
const { getHouseholdDb, closeHouseholdConnection } = require('../db/household');
const { logHouseholdAudit } = require('../services/auditService');

const SQLITE_MAGIC = 'SQLite format 3\u0000';

function timestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

async function backupRoutes(app) {
  // Scoped to this plugin only (Fastify encapsulation) — every other route keeps
  // the default JSON-only content type parsing.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (request, body, done) => {
    done(null, body);
  });

  // ---- Export: download the household's live SQLite file as-is ----
  app.get('/api/household/backup', async (request, reply) => {
    request.householdDb.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    const filePath = path.join(householdsDir, `${request.household.database_key}.sqlite`);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="capbudget-backup-${timestamp()}.sqlite"`);
    return reply.send(fs.createReadStream(filePath));
  });

  // ---- Restore: overwrite the household's SQLite file from an uploaded backup ----
  app.post('/api/household/restore', { bodyLimit: maxRestoreBytes }, async (request, reply) => {
    const buffer = request.body;
    if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.subarray(0, 16).toString('latin1') !== SQLITE_MAGIC) {
      reply.code(400);
      return { error: "Le fichier fourni n'est pas une sauvegarde SQLite valide." };
    }

    const databaseKey = request.household.database_key;
    const filePath = path.join(householdsDir, `${databaseKey}.sqlite`);

    // Safety net in case the upload was a mistake — keep the pre-restore file.
    fs.mkdirSync(backupsDir, { recursive: true });
    const safetyPath = path.join(backupsDir, `${databaseKey}_pre-restore_${timestamp()}.sqlite`);
    try { fs.copyFileSync(filePath, safetyPath); } catch { /* nothing to back up yet */ }

    closeHouseholdConnection(request.householdId);
    fs.writeFileSync(filePath, buffer);
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(`${filePath}${suffix}`); } catch { /* no sidecar */ }
    }

    // Reopen now (reruns schema migrations) rather than surprising the next request.
    const restoredDb = getHouseholdDb(request.householdId);
    logHouseholdAudit(restoredDb, request.householdId, request.user.id, 'RESTORE', 'household', request.householdId, null, { databaseKey });

    return { ok: true };
  });
}

module.exports = backupRoutes;
