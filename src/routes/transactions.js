// @ts-check
'use strict';

const { newId } = require('../util/ids');
const { logHouseholdAudit } = require('../services/auditService');
const { getBudgetStartDay } = require('../db/household');
const { budgetMonthToDateRange } = require('../util/budgetMonth');

// A transaction always belongs to a cashflow; fall back to the household's default
// one whenever the caller doesn't explicitly pick another (or "ignorer sur cashflow").
function resolveDefaultCashflowId(db, householdId) {
  const defaultCashflow = db.prepare(
    'SELECT id FROM cashflows WHERE household_id = ? AND is_default = 1 AND is_archived = 0 LIMIT 1'
  ).get(householdId);
  return defaultCashflow ? defaultCashflow.id : null;
}

function buildTransactionFilters(query, budgetStartDay) {
  const clauses = [];
  const params = [];
  if (query.startMonth) {
    clauses.push('operation_date >= ?');
    params.push(budgetMonthToDateRange(query.startMonth, budgetStartDay).startDate);
  }
  if (query.endMonth) {
    clauses.push('operation_date <= ?');
    params.push(budgetMonthToDateRange(query.endMonth, budgetStartDay).endDate);
  }
  if (query.accountId) {
    clauses.push('account_id = ?');
    params.push(query.accountId);
  }
  if (query.cashflowId) {
    clauses.push('cashflow_id = ?');
    params.push(query.cashflowId);
  }
  if (query.nature) {
    clauses.push('nature = ?');
    params.push(query.nature);
  }
  if (query.categoryId) {
    clauses.push('category_id = ?');
    params.push(query.categoryId);
  }
  if (query.subcategoryId) {
    clauses.push('subcategory_id = ?');
    params.push(query.subcategoryId);
  }
  if (query.status) {
    clauses.push('status = ?');
    params.push(query.status);
  }
  if (query.search) {
    clauses.push('(raw_label LIKE ? OR comment LIKE ?)');
    params.push(`%${query.search}%`, `%${query.search}%`);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

async function transactionRoutes(app) {
  app.get('/api/transactions', async (request) => {
    const { where, params } = buildTransactionFilters(request.query, getBudgetStartDay(request.householdDb));
    const limit = Math.min(Number(request.query.limit) || 200, 1000);
    const rows = request.householdDb.prepare(`
      SELECT * FROM transactions ${where} ORDER BY operation_date DESC, created_at DESC LIMIT ?
    `).all(...params, limit);
    return rows;
  });

  app.get('/api/transactions/to-verify', async (request) => {
    const db = request.householdDb;
    const nonAffecteeIds = db.prepare("SELECT id FROM categories WHERE is_system = 1").all().map((r) => r.id);
    const placeholders = nonAffecteeIds.map(() => '?').join(',') || 'NULL';
    const uncategorized = db.prepare(`
      SELECT * FROM transactions WHERE status='ACTIVE' AND category_id IN (${placeholders})
    `).all(...nonAffecteeIds);
    const potentialDuplicates = db.prepare(`
      SELECT t.* FROM transactions t
      JOIN raw_import_rows r ON r.transaction_id = t.id
      WHERE r.parse_status = 'POTENTIAL_DUPLICATE' AND t.status='ACTIVE'
    `).all();
    const importErrors = db.prepare("SELECT * FROM raw_import_rows WHERE parse_status = 'ERROR' ORDER BY row_number").all();
    return {
      uncategorized: { count: uncategorized.length, items: uncategorized },
      potentialDuplicates: { count: potentialDuplicates.length, items: potentialDuplicates },
      importErrors: { count: importErrors.length, items: importErrors }
    };
  });

  app.post('/api/transactions', async (request, reply) => {
    const { operationDate, label, amountCents, categoryId, subcategoryId, cashflowId, nature, accountId, comment } = request.body || {};
    if (!operationDate || !label || !Number.isFinite(amountCents) || !categoryId || !nature) {
      reply.code(400);
      return { error: 'Date, libellé, montant, catégorie et nature requis.' };
    }
    const id = newId('txn');
    request.householdDb.prepare(`
      INSERT INTO transactions (
        id, household_id, account_id, operation_date, raw_label, amount_cents, currency_code,
        comment, category_id, subcategory_id, cashflow_id, nature, status, source, is_manually_edited,
        created_by_user_id, updated_by_user_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, 'ACTIVE', 'MANUAL', 1, ?, ?)
    `).run(id, request.householdId, accountId || null, operationDate, label, amountCents, comment || null, categoryId, subcategoryId || null, cashflowId || resolveDefaultCashflowId(request.householdDb, request.householdId), nature, request.user.id, request.user.id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'CREATE', 'transaction', id, null, request.body);
    reply.code(201);
    return { id };
  });

  app.put('/api/transactions/:id', async (request, reply) => {
    const { id } = request.params;
    const txn = request.householdDb.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!txn) {
      reply.code(404);
      return { error: 'Transaction introuvable.' };
    }
    const { categoryId, subcategoryId, cashflowId, nature, comment, label, excludedFromCashflow } = request.body || {};
    // A category change invalidates any previously selected subcategory unless the
    // caller explicitly supplies a new one alongside it.
    const categoryChanged = categoryId !== undefined && categoryId !== txn.category_id;
    const next = {
      category_id: categoryId !== undefined ? categoryId : txn.category_id,
      subcategory_id: subcategoryId !== undefined ? subcategoryId : (categoryChanged ? null : txn.subcategory_id),
      cashflow_id: cashflowId !== undefined ? cashflowId : txn.cashflow_id,
      nature: nature !== undefined ? nature : txn.nature,
      comment: comment !== undefined ? comment : txn.comment,
      raw_label: label !== undefined ? label : txn.raw_label,
      excluded_from_cashflow: excludedFromCashflow !== undefined ? (excludedFromCashflow ? 1 : 0) : txn.excluded_from_cashflow
    };
    request.householdDb.prepare(`
      UPDATE transactions SET category_id=?, subcategory_id=?, cashflow_id=?, nature=?, comment=?, raw_label=?,
      excluded_from_cashflow=?, is_manually_edited = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by_user_id = ?
      WHERE id = ?
    `).run(next.category_id, next.subcategory_id, next.cashflow_id, next.nature, next.comment, next.raw_label, next.excluded_from_cashflow, request.user.id, id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'transaction', id, txn, next);
    return { ok: true };
  });

  app.put('/api/transactions/bulk', async (request, reply) => {
    const { ids, categoryId, subcategoryId, cashflowId, nature } = request.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      reply.code(400);
      return { error: 'Liste de transactions requise.' };
    }
    const db = request.householdDb;
    const update = db.prepare(`
      UPDATE transactions SET
        category_id = COALESCE(?, category_id),
        subcategory_id = COALESCE(?, subcategory_id),
        cashflow_id = COALESCE(?, cashflow_id),
        nature = COALESCE(?, nature),
        is_manually_edited = 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        updated_by_user_id = ?
      WHERE id = ?
    `);
    for (const txnId of ids) update.run(categoryId || null, subcategoryId || null, cashflowId || null, nature || null, request.user.id, txnId);
    logHouseholdAudit(db, request.householdId, request.user.id, 'BULK_UPDATE', 'transaction', null, null, { ids, categoryId, subcategoryId, cashflowId, nature });
    return { ok: true, updatedCount: ids.length };
  });

  app.put('/api/transactions/:id/archive', async (request, reply) => {
    const { id } = request.params;
    const txn = request.householdDb.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!txn) {
      reply.code(404);
      return { error: 'Transaction introuvable.' };
    }
    request.householdDb.prepare("UPDATE transactions SET status = 'ARCHIVED' WHERE id = ?").run(id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'ARCHIVE', 'transaction', id, { status: txn.status }, { status: 'ARCHIVED' });
    return { ok: true };
  });

  app.delete('/api/transactions/:id', async (request, reply) => {
    const { id } = request.params;
    const txn = request.householdDb.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!txn) {
      reply.code(404);
      return { error: 'Transaction introuvable.' };
    }
    if (txn.source !== 'MANUAL') {
      reply.code(409);
      return { error: 'Seule une transaction manuelle peut être supprimée. Archivez les transactions importées.' };
    }
    request.householdDb.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'DELETE', 'transaction', id, txn, null);
    return { ok: true };
  });
}

module.exports = transactionRoutes;
