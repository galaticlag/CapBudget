'use strict';

const { newId } = require('../util/ids');
const { logHouseholdAudit } = require('../services/auditService');
const { findMatchingRule, isSafeRegex, matches } = require('../services/ruleService');

function computeReprocessPlan(db) {
  const transactions = db.prepare("SELECT * FROM transactions WHERE status = 'ACTIVE'").all();
  const eligible = [];
  const skippedManual = [];
  for (const txn of transactions) {
    const rule = findMatchingRule(db, txn.raw_label, txn.suggested_label, txn.comment);
    if (!rule) continue;
    const changed = (rule.category_id && rule.category_id !== txn.category_id)
      || (rule.subcategory_id && rule.subcategory_id !== txn.subcategory_id)
      || (rule.cashflow_id && rule.cashflow_id !== txn.cashflow_id)
      || (rule.nature && rule.nature !== txn.nature);
    if (!changed) continue;
    if (txn.is_manually_edited) {
      skippedManual.push(txn.id);
    } else {
      eligible.push({ transaction: txn, rule });
    }
  }
  return { eligible, skippedManual };
}

async function rulesRoutes(app) {
  app.get('/api/rules', async (request) => {
    return request.householdDb.prepare('SELECT * FROM categorization_rules ORDER BY created_at').all();
  });

  app.post('/api/rules', async (request, reply) => {
    const {
      name, matchRawLabel, matchSuggestedLabel, matchComment, matchType, matchValue,
      categoryId, subcategoryId, cashflowId, nature
    } = request.body || {};
    const matchRaw = Boolean(matchRawLabel);
    const matchSuggested = Boolean(matchSuggestedLabel);
    const matchCmt = Boolean(matchComment);
    if (!name || (!matchRaw && !matchSuggested && !matchCmt) || !['CONTAINS', 'EQUALS', 'REGEX'].includes(matchType) || !matchValue) {
      reply.code(400);
      return { error: 'Nom, au moins un champ à comparer, type et valeur de correspondance requis.' };
    }
    if (matchType === 'REGEX' && !isSafeRegex(matchValue)) {
      reply.code(400);
      return { error: 'Expression régulière invalide ou trop complexe (risque de déni de service).' };
    }
    const id = newId('rule');
    // match_field is kept only to satisfy the legacy NOT NULL/CHECK constraint; it is no
    // longer used for matching (see match_raw_label/match_suggested_label/match_comment).
    const legacyMatchField = matchRaw ? 'RAW_LABEL' : (matchSuggested ? 'SUGGESTED_LABEL' : 'RAW_LABEL');
    request.householdDb.prepare(`
      INSERT INTO categorization_rules
        (id, household_id, name, match_field, match_raw_label, match_suggested_label, match_comment, match_type, match_value, category_id, subcategory_id, cashflow_id, nature, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(id, request.householdId, String(name).trim(), legacyMatchField, matchRaw ? 1 : 0, matchSuggested ? 1 : 0, matchCmt ? 1 : 0, matchType, matchValue, categoryId || null, subcategoryId || null, cashflowId || null, nature || null);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'CREATE', 'rule', id, null, request.body);
    reply.code(201);
    return { id };
  });

  app.put('/api/rules/:id', async (request, reply) => {
    const { id } = request.params;
    const rule = request.householdDb.prepare('SELECT * FROM categorization_rules WHERE id = ?').get(id);
    if (!rule) {
      reply.code(404);
      return { error: 'Règle introuvable.' };
    }
    const {
      name, matchRawLabel, matchSuggestedLabel, matchComment, matchType, matchValue,
      categoryId, subcategoryId, cashflowId, nature, isActive
    } = request.body || {};
    if (matchType === 'REGEX' && matchValue && !isSafeRegex(matchValue)) {
      reply.code(400);
      return { error: 'Expression régulière invalide ou trop complexe.' };
    }
    const next = {
      name: name !== undefined ? String(name).trim() : rule.name,
      match_raw_label: matchRawLabel !== undefined ? (matchRawLabel ? 1 : 0) : rule.match_raw_label,
      match_suggested_label: matchSuggestedLabel !== undefined ? (matchSuggestedLabel ? 1 : 0) : rule.match_suggested_label,
      match_comment: matchComment !== undefined ? (matchComment ? 1 : 0) : rule.match_comment,
      match_type: matchType || rule.match_type,
      match_value: matchValue !== undefined ? matchValue : rule.match_value,
      category_id: categoryId !== undefined ? categoryId : rule.category_id,
      subcategory_id: subcategoryId !== undefined ? subcategoryId : rule.subcategory_id,
      cashflow_id: cashflowId !== undefined ? cashflowId : rule.cashflow_id,
      nature: nature !== undefined ? nature : rule.nature,
      is_active: typeof isActive === 'boolean' ? (isActive ? 1 : 0) : rule.is_active
    };
    if (!next.match_raw_label && !next.match_suggested_label && !next.match_comment) {
      reply.code(400);
      return { error: 'Au moins un champ à comparer est requis.' };
    }
    request.householdDb.prepare(`
      UPDATE categorization_rules SET name=?, match_raw_label=?, match_suggested_label=?, match_comment=?, match_type=?, match_value=?, category_id=?, subcategory_id=?, cashflow_id=?, nature=?, is_active=?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?
    `).run(next.name, next.match_raw_label, next.match_suggested_label, next.match_comment, next.match_type, next.match_value, next.category_id, next.subcategory_id, next.cashflow_id, next.nature, next.is_active, id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'rule', id, rule, next);
    return { ok: true };
  });

  app.delete('/api/rules/:id', async (request, reply) => {
    const { id } = request.params;
    const rule = request.householdDb.prepare('SELECT * FROM categorization_rules WHERE id = ?').get(id);
    if (!rule) {
      reply.code(404);
      return { error: 'Règle introuvable.' };
    }
    request.householdDb.prepare('DELETE FROM categorization_rules WHERE id = ?').run(id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'DELETE', 'rule', id, rule, null);
    return { ok: true };
  });

  // Preview affected transaction count for a single rule definition before saving.
  app.post('/api/rules/preview', async (request) => {
    const { matchRawLabel, matchSuggestedLabel, matchComment, matchType, matchValue } = request.body || {};
    if (matchType === 'REGEX' && !isSafeRegex(matchValue)) {
      return { matchCount: 0, invalid: true };
    }
    const fakeRule = {
      match_raw_label: Boolean(matchRawLabel),
      match_suggested_label: Boolean(matchSuggestedLabel),
      match_comment: Boolean(matchComment),
      match_type: matchType,
      match_value: matchValue
    };
    const transactions = request.householdDb.prepare("SELECT raw_label, suggested_label, comment FROM transactions WHERE status='ACTIVE'").all();
    const matchCount = transactions.filter((t) => matches(fakeRule, t.raw_label, t.suggested_label, t.comment)).length;
    return { matchCount };
  });

  app.get('/api/rules/reprocess/preview', async (request) => {
    const { eligible, skippedManual } = computeReprocessPlan(request.householdDb);
    return {
      eligibleCount: eligible.length,
      skippedManualCount: skippedManual.length,
      sample: eligible.slice(0, 20).map((e) => ({
        transactionId: e.transaction.id,
        rawLabel: e.transaction.raw_label,
        ruleId: e.rule.id,
        ruleName: e.rule.name
      }))
    };
  });

  app.post('/api/rules/reprocess/apply', async (request) => {
    const { overwriteManual } = request.body || {};
    const { eligible, skippedManual } = computeReprocessPlan(request.householdDb);
    let appliedCount = 0;
    const targets = overwriteManual
      ? [...eligible, ...request.householdDb.prepare("SELECT * FROM transactions WHERE status='ACTIVE' AND is_manually_edited = 1").all().map((t) => {
          const rule = findMatchingRule(request.householdDb, t.raw_label, t.suggested_label, t.comment);
          return rule ? { transaction: t, rule } : null;
        }).filter(Boolean)]
      : eligible;
    for (const { transaction, rule } of targets) {
      request.householdDb.prepare(`
        UPDATE transactions SET
          category_id = COALESCE(?, category_id),
          subcategory_id = COALESCE(?, subcategory_id),
          cashflow_id = COALESCE(?, cashflow_id),
          nature = COALESCE(?, nature),
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_by_user_id = ?
        WHERE id = ?
      `).run(rule.category_id, rule.subcategory_id, rule.cashflow_id, rule.nature, request.user.id, transaction.id);
      appliedCount += 1;
    }
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'REPROCESS', 'transaction', null, null, {
      appliedCount,
      skippedManualCount: skippedManual.length,
      overwriteManual: Boolean(overwriteManual)
    });
    return { appliedCount, skippedManualCount: overwriteManual ? 0 : skippedManual.length };
  });
}

module.exports = rulesRoutes;
