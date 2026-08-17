// @ts-check
'use strict';

const { newId } = require('../util/ids');
const { maxCsvBytes } = require('../config');
const { logHouseholdAudit } = require('../services/auditService');
const {
  parseCsvStructure,
  buildColumnMapping,
  mappingToHeaderNames,
  evaluateRow,
  categorizeRow,
  checksum
} = require('../services/importService');

function assertCsvSize(csvText, reply) {
  const bytes = Buffer.byteLength(String(csvText || ''), 'utf8');
  if (bytes > maxCsvBytes) {
    reply.code(413);
    return false;
  }
  return true;
}

async function importRoutes(app) {
  app.post('/api/import/preview', async (request, reply) => {
    const { csvText, filename, delimiter: delimiterOverride, mapping: explicitMapping } = request.body || {};
    if (!csvText || !String(csvText).trim()) {
      reply.code(400);
      return { error: 'Fichier CSV vide.' };
    }
    if (!assertCsvSize(csvText, reply)) {
      return { error: `Fichier CSV trop volumineux (limite ${maxCsvBytes / (1024 * 1024)} Mo).` };
    }
    const { delimiter, headers, dataLines } = parseCsvStructure(csvText, delimiterOverride);
    if (headers.length === 0) {
      reply.code(400);
      return { error: 'En-têtes CSV introuvables.' };
    }
    const mapping = buildColumnMapping(headers, explicitMapping);
    const missingRequired = ['operation_date', 'label', 'amount'].filter((f) => mapping[f] < 0);
    if (missingRequired.length > 0 || (mapping.account_reference < 0 && mapping.account_label < 0)) {
      return {
        delimiter,
        headers,
        mapping: mappingToHeaderNames(mapping, headers),
        error: 'Colonnes obligatoires non mappées (date, libellé, montant, compte).',
        rows: [],
        summary: { total: dataLines.length, valid: 0, duplicate: 0, potentialDuplicate: 0, error: dataLines.length }
      };
    }

    const batchSeen = [];
    const rows = dataLines.map((line, i) => evaluateRow(request.householdDb, request.householdId, line, delimiter, mapping, i + 2, { create: false, batchSeen }));
    const categoriesById = new Map(request.householdDb.prepare('SELECT id, name FROM categories').all().map((c) => [c.id, c.name]));
    const subcategoriesById = new Map(request.householdDb.prepare('SELECT id, name FROM subcategories').all().map((s) => [s.id, s.name]));
    for (const row of rows) {
      if (row.status !== 'IMPORTED' && row.status !== 'POTENTIAL_DUPLICATE') continue;
      const categorization = categorizeRow(request.householdDb, request.householdId, row, { create: false });
      row.categorization = {
        ...categorization,
        categoryName: categorization.categoryName || categoriesById.get(categorization.categoryId) || null,
        subcategoryName: categorization.subcategoryName || subcategoriesById.get(categorization.subcategoryId) || null,
        willCreateCategory: categorization.source === 'CSV' && !categorization.categoryId,
        willCreateSubcategory: categorization.source === 'CSV' && Boolean(categorization.subcategoryName) && !categorization.subcategoryId
      };
    }
    const summary = {
      total: rows.length,
      valid: rows.filter((r) => r.status === 'IMPORTED').length,
      duplicate: rows.filter((r) => r.status === 'DUPLICATE').length,
      potentialDuplicate: rows.filter((r) => r.status === 'POTENTIAL_DUPLICATE').length,
      error: rows.filter((r) => r.status === 'ERROR').length
    };
    return { delimiter, headers, mapping: mappingToHeaderNames(mapping, headers), filename: filename || 'import.csv', rows: rows.slice(0, 500), summary };
  });

  app.post('/api/import/commit', async (request, reply) => {
    const { csvText, filename, delimiter: delimiterOverride, mapping: explicitMapping, retention } = request.body || {};
    if (!csvText || !String(csvText).trim()) {
      reply.code(400);
      return { error: 'Fichier CSV vide.' };
    }
    if (!assertCsvSize(csvText, reply)) {
      return { error: `Fichier CSV trop volumineux (limite ${maxCsvBytes / (1024 * 1024)} Mo).` };
    }
    const db = request.householdDb;
    const { delimiter, headers, dataLines } = parseCsvStructure(csvText, delimiterOverride);
    const mapping = buildColumnMapping(headers, explicitMapping);
    const missingRequired = ['operation_date', 'label', 'amount'].filter((f) => mapping[f] < 0);
    if (missingRequired.length > 0 || (mapping.account_reference < 0 && mapping.account_label < 0)) {
      reply.code(400);
      return { error: 'Colonnes obligatoires non mappées.' };
    }

    const batchId = newId('batch');
    db.prepare(`
      INSERT INTO import_batches (id, household_id, original_filename, file_checksum, mapping_definition_json, imported_by_user_id, row_count, source_file_retention)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(batchId, request.householdId, filename || 'import.csv', checksum(csvText), JSON.stringify(mapping), request.user.id, dataLines.length, retention === 'KEEP' ? 'KEEP' : 'DELETE_AFTER_IMPORT');

    let createdCount = 0;
    let duplicateCount = 0;
    let potentialDuplicateCount = 0;
    let errorCount = 0;
    const createdTransactionIds = [];
    const batchSeen = [];

    for (let i = 0; i < dataLines.length; i += 1) {
      const rowNumber = i + 2;
      const evaluated = evaluateRow(db, request.householdId, dataLines[i], delimiter, mapping, rowNumber, { create: true, batchSeen });

      if (evaluated.status === 'ERROR') {
        errorCount += 1;
        db.prepare(`
          INSERT INTO raw_import_rows (id, import_batch_id, row_number, raw_payload_json, parse_status, error_message)
          VALUES (?, ?, ?, ?, 'ERROR', ?)
        `).run(newId('rawrow'), batchId, rowNumber, JSON.stringify(evaluated.raw), evaluated.errors.join(' '));
        continue;
      }

      if (evaluated.status === 'DUPLICATE') {
        duplicateCount += 1;
        db.prepare(`
          INSERT INTO raw_import_rows (id, import_batch_id, row_number, raw_payload_json, parse_status, transaction_id)
          VALUES (?, ?, ?, ?, 'DUPLICATE', ?)
        `).run(newId('rawrow'), batchId, rowNumber, JSON.stringify(evaluated), evaluated.existingTransactionId);
        continue;
      }

      // IMPORTED or POTENTIAL_DUPLICATE both result in a new transaction, per spec
      // ("une transaction similaire non certaine ... reste à valider" — it is created, not dropped).
      const { categoryId, subcategoryId, cashflowId, nature } = categorizeRow(db, request.householdId, evaluated, { create: true });
      const txnId = newId('txn');
      db.prepare(`
        INSERT INTO transactions (
          id, household_id, account_id, import_batch_id, operation_date, value_date, raw_label, suggested_label,
          amount_cents, currency_code, balance_after_cents, comment, category_id, subcategory_id, cashflow_id,
          nature, status, source, source_fingerprint, is_manually_edited, created_by_user_id, updated_by_user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?, 'ACTIVE', 'IMPORT', ?, 0, ?, ?)
      `).run(
        txnId, request.householdId, evaluated.accountId, batchId, evaluated.operationDate, evaluated.valueDate,
        evaluated.label, evaluated.suggestedLabel, evaluated.amountCents, evaluated.balanceCents ?? null, evaluated.comment,
        categoryId, subcategoryId, cashflowId, nature, evaluated.fingerprint, request.user.id, request.user.id
      );

      const status = evaluated.status === 'POTENTIAL_DUPLICATE' ? 'POTENTIAL_DUPLICATE' : 'IMPORTED';
      if (status === 'POTENTIAL_DUPLICATE') potentialDuplicateCount += 1;
      createdCount += 1;
      createdTransactionIds.push(txnId);
      db.prepare(`
        INSERT INTO raw_import_rows (id, import_batch_id, row_number, raw_payload_json, parse_status, transaction_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(newId('rawrow'), batchId, rowNumber, JSON.stringify(evaluated), status, txnId);
    }

    db.prepare(`
      UPDATE import_batches SET created_count = ?, duplicate_count = ?, potential_duplicate_count = ?, error_count = ? WHERE id = ?
    `).run(createdCount, duplicateCount, potentialDuplicateCount, errorCount, batchId);

    logHouseholdAudit(db, request.householdId, request.user.id, 'IMPORT', 'import_batch', batchId, null, {
      filename, createdCount, duplicateCount, potentialDuplicateCount, errorCount
    });

    return {
      batchId,
      rowCount: dataLines.length,
      createdCount,
      duplicateCount,
      potentialDuplicateCount,
      errorCount,
      transactionIds: createdTransactionIds
    };
  });

  app.post('/api/import/:batchId/cancel', async (request, reply) => {
    const { batchId } = request.params;
    const db = request.householdDb;
    const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
    if (!batch) {
      reply.code(404);
      return { error: 'Lot introuvable.' };
    }
    if (batch.cancelled_at) {
      reply.code(409);
      return { error: 'Lot déjà annulé.' };
    }
    // Only delete transactions this batch actually created — never duplicates
    // that pointed at a pre-existing transaction, and never manual enrichment.
    const created = db.prepare("SELECT id FROM transactions WHERE import_batch_id = ? AND source = 'IMPORT'").all(batchId);
    const deleteTxn = db.prepare('DELETE FROM transactions WHERE id = ?');
    for (const row of created) deleteTxn.run(row.id);
    db.prepare("UPDATE import_batches SET cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(batchId);
    logHouseholdAudit(db, request.householdId, request.user.id, 'CANCEL_IMPORT', 'import_batch', batchId, null, { deletedCount: created.length });
    return { ok: true, deletedCount: created.length };
  });

  app.get('/api/import/batches', async (request) => {
    return request.householdDb.prepare('SELECT * FROM import_batches ORDER BY imported_at DESC').all();
  });

  app.get('/api/import/:batchId/rows', async (request, reply) => {
    const { batchId } = request.params;
    const rows = request.householdDb.prepare('SELECT * FROM raw_import_rows WHERE import_batch_id = ? ORDER BY row_number').all(batchId);
    if (rows.length === 0) {
      reply.code(404);
      return { error: 'Lot introuvable ou vide.' };
    }
    return rows;
  });
}

module.exports = importRoutes;
