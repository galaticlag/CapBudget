// @ts-check
'use strict';

const crypto = require('node:crypto');
const { newId } = require('../util/ids');
const cryptoUtil = require('../util/crypto');
const { normalizeHeader, detectDelimiter, splitCsvLine, parseDateStrict, parseAmount, computeFingerprint } = require('../util/csv');
const { findMatchingRule } = require('./ruleService');

const FIELD_ALIASES = {
  operation_date: ['operation_date', 'date', 'dateop', 'date_op'],
  value_date: ['value_date', 'date_valeur', 'datevaleur', 'dateval'],
  label: ['label', 'libelle', 'description', 'raw_label'],
  suggested_label: ['suggested_label', 'libelle_suggere', 'suggestedlabel'],
  amount: ['amount', 'montant', 'value'],
  account_reference: ['account_reference', 'compte', 'account', 'iban', 'accountnum'],
  account_label: ['account_label', 'nom_compte', 'account_name', 'accountlabel'],
  balance: ['balance', 'solde', 'accountbalance'],
  comment: ['comment', 'commentaire'],
  // Some bank exports (e.g. Linxo/Bankin-style) name the broad category "categoryParent"
  // and use the plain "category" column for the more specific sub-category.
  source_category: ['source_category', 'categorie', 'categoryparent', 'category_parent', 'parent_category'],
  source_subcategory: ['source_subcategory', 'sous_categorie', 'category', 'subcategory']
};
const REQUIRED_FIELDS = ['operation_date', 'label', 'amount'];

function splitLines(csvText) {
  return String(csvText || '').split(/\r\n|\r|\n/).filter((line) => line.trim().length > 0);
}

function buildColumnMapping(headers, explicitMapping) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping = {};
  const fields = Object.keys(FIELD_ALIASES);
  for (const field of fields) {
    if (explicitMapping && explicitMapping[field]) {
      const target = normalizeHeader(explicitMapping[field]);
      const idx = normalizedHeaders.indexOf(target);
      mapping[field] = idx;
      continue;
    }
    const aliases = FIELD_ALIASES[field];
    const idx = normalizedHeaders.findIndex((h) => aliases.includes(h));
    mapping[field] = idx;
  }
  return mapping;
}

// Converts the internal index-based mapping into the header-name form used on
// the wire, so the client can resend it unchanged as an "explicitMapping" on
// the next call without index/name confusion.
function mappingToHeaderNames(mapping, headers) {
  const named = {};
  for (const [field, idx] of Object.entries(mapping)) {
    named[field] = idx >= 0 ? headers[idx] : null;
  }
  return named;
}

function parseCsvStructure(csvText, delimiterOverride) {
  const lines = splitLines(csvText);
  if (lines.length === 0) {
    return { delimiter: ';', headers: [], dataLines: [] };
  }
  const delimiter = delimiterOverride || detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter);
  return { delimiter, headers, dataLines: lines.slice(1) };
}

function getField(fields, mapping, name) {
  const idx = mapping[name];
  if (idx === undefined || idx < 0) return '';
  return fields[idx] !== undefined ? fields[idx] : '';
}

// Resolves (or, in commit mode, creates) the account matching a CSV reference.
// Never trusted with a client-supplied DB path — only reads/writes rows via the
// already-resolved household connection.
function resolveAccount(db, householdId, reference, label, { create }) {
  const key = String(reference || label || '').trim();
  if (!key) return null;
  const lookup = cryptoUtil.lookupHash(key);
  const existing = db.prepare('SELECT * FROM accounts WHERE bank_account_reference_lookup = ?').get(lookup);
  if (existing) return existing;
  if (!create) return { id: null, pending: true };
  const id = newId('account');
  db.prepare(`
    INSERT INTO accounts (id, household_id, bank_account_reference_encrypted, bank_account_reference_masked, bank_account_reference_lookup, bank_account_label)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, householdId, cryptoUtil.encrypt(key), cryptoUtil.mask(key), lookup, label || key);
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

function evaluateRow(db, householdId, rawLine, delimiter, mapping, rowNumber, { create, batchSeen }) {
  const fields = splitCsvLine(rawLine, delimiter);
  const errors = [];

  const operationDate = parseDateStrict(getField(fields, mapping, 'operation_date'));
  const valueDateRaw = getField(fields, mapping, 'value_date');
  const valueDate = valueDateRaw ? parseDateStrict(valueDateRaw) : null;
  const label = getField(fields, mapping, 'label').trim();
  const suggestedLabel = getField(fields, mapping, 'suggested_label').trim() || null;
  const amountCents = parseAmount(getField(fields, mapping, 'amount'));
  const accountReference = getField(fields, mapping, 'account_reference').trim();
  const accountLabel = getField(fields, mapping, 'account_label').trim();
  const balanceCents = parseAmount(getField(fields, mapping, 'balance'));
  // Certains formats bancaires (Bankin/Linxo) laissent la colonne "comment" toujours
  // vide et placent le libellé suggéré par la banque dans une colonne dédiée. On
  // utilise ce libellé suggéré comme commentaire initial dans ce cas, pour qu'il
  // reste visible et modifiable sur la revue des transactions.
  const comment = getField(fields, mapping, 'comment').trim() || suggestedLabel || null;
  const sourceCategory = getField(fields, mapping, 'source_category').trim() || null;
  const sourceSubcategory = getField(fields, mapping, 'source_subcategory').trim() || null;

  if (!operationDate) errors.push('Date d\'opération manquante, ambiguë ou invalide.');
  if (valueDateRaw && !valueDate) errors.push('Date de valeur invalide.');
  if (!label) errors.push('Libellé manquant.');
  if (amountCents === null) errors.push('Montant manquant ou invalide.');
  if (!accountReference && !accountLabel) errors.push('Référence ou libellé de compte requis.');

  if (errors.length > 0) {
    return { rowNumber, status: 'ERROR', errors, raw: fields };
  }

  const account = resolveAccount(db, householdId, accountReference, accountLabel, { create });
  const accountId = account ? account.id : null;

  const fingerprint = computeFingerprint({
    accountId: accountId || accountReference || accountLabel,
    operationDate,
    valueDate,
    amountCents,
    currencyCode: 'EUR',
    rawLabel: label
  });

  const existingTxn = db.prepare('SELECT id FROM transactions WHERE source_fingerprint = ?').get(fingerprint);
  const batchDuplicate = !existingTxn && batchSeen && batchSeen.some((r) => r.fingerprint === fingerprint);
  if (existingTxn || batchDuplicate) {
    return {
      rowNumber,
      status: 'DUPLICATE',
      errors: [],
      operationDate,
      valueDate,
      label,
      suggestedLabel,
      amountCents,
      accountReference,
      accountLabel,
      accountId,
      sourceCategory,
      sourceSubcategory,
      fingerprint,
      existingTransactionId: existingTxn ? existingTxn.id : null
    };
  }

  // Potential duplicate heuristic: same account/amount and a close-by date, different label —
  // not certain enough to silently skip, but flagged for manual review per spec.
  const potentialFromDb = db.prepare(`
    SELECT id FROM transactions
    WHERE account_id IS ? AND ABS(amount_cents - ?) < 1
      AND julianday(operation_date) BETWEEN julianday(?) - 3 AND julianday(?) + 3
      AND raw_label != ?
    LIMIT 1
  `).get(accountId, amountCents, operationDate, operationDate, label);

  const potentialFromBatch = !potentialFromDb && batchSeen && batchSeen.find((r) =>
    r.accountId === accountId &&
    Math.abs(r.amountCents - amountCents) < 1 &&
    Math.abs((new Date(r.operationDate).getTime() - new Date(operationDate).getTime()) / 86400000) <= 3 &&
    r.label !== label
  );
  const potential = potentialFromDb || potentialFromBatch;

  if (batchSeen) batchSeen.push({ fingerprint, accountId, amountCents, operationDate, label });

  return {
    rowNumber,
    status: potential ? 'POTENTIAL_DUPLICATE' : 'IMPORTED',
    errors: [],
    operationDate,
    valueDate,
    label,
    suggestedLabel,
    amountCents,
    balanceCents,
    comment,
    accountReference,
    accountLabel,
    accountId,
    sourceCategory,
    sourceSubcategory,
    fingerprint,
    potentialDuplicateOf: potentialFromDb ? potentialFromDb.id : null
  };
}

// Resolves a household category/subcategory by name (case-insensitive), matched against
// the CSV's own "category"/"subcategory" columns when mapped. In preview mode (create:false)
// this never writes anything, so the wizard can show what *would* be matched/created.
function resolveCategoryFromSource(db, householdId, sourceCategoryName, sourceSubcategoryName, { create }) {
  const catName = String(sourceCategoryName || '').trim();
  if (!catName) return { categoryId: null, subcategoryId: null };

  // Categories are shared across revenue/expense transactions (no more per-kind scoping),
  // so matching/creation here is name-only; "kind" is kept populated for schema compat only.
  let category = db.prepare(
    'SELECT * FROM categories WHERE household_id = ? AND is_active = 1 AND lower(name) = lower(?)'
  ).get(householdId, catName);
  let categoryCreated = false;
  if (!category && create) {
    const id = newId('cat');
    const { m } = db.prepare('SELECT COALESCE(MAX(display_order), 0) AS m FROM categories WHERE household_id = ?').get(householdId);
    db.prepare(`
      INSERT INTO categories (id, household_id, name, kind, display_order, is_system, is_active)
      VALUES (?, ?, ?, 'EXPENSE', ?, 0, 1)
    `).run(id, householdId, catName, m + 1);
    category = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    categoryCreated = true;
  }
  if (!category) {
    return {
      categoryId: null,
      subcategoryId: null,
      categoryName: catName,
      subcategoryName: String(sourceSubcategoryName || '').trim() || null,
      categoryCreated: false
    };
  }

  const subName = String(sourceSubcategoryName || '').trim();
  if (!subName) return { categoryId: category.id, subcategoryId: null, categoryName: category.name, categoryCreated };

  let subcategory = db.prepare(
    'SELECT * FROM subcategories WHERE category_id = ? AND is_active = 1 AND lower(name) = lower(?)'
  ).get(category.id, subName);
  let subcategoryCreated = false;
  if (!subcategory && create) {
    const subId = newId('sub');
    const { m } = db.prepare('SELECT COALESCE(MAX(display_order), 0) AS m FROM subcategories WHERE category_id = ?').get(category.id);
    db.prepare(`
      INSERT INTO subcategories (id, household_id, category_id, name, display_order, is_system, is_active)
      VALUES (?, ?, ?, ?, ?, 0, 1)
    `).run(subId, householdId, category.id, subName, m + 1);
    subcategory = db.prepare('SELECT * FROM subcategories WHERE id = ?').get(subId);
    subcategoryCreated = true;
  }
  return {
    categoryId: category.id,
    subcategoryId: subcategory ? subcategory.id : null,
    categoryName: category.name,
    subcategoryName: subName,
    categoryCreated,
    subcategoryCreated
  };
}

// A transaction always lands on a cashflow: the household's default one unless a
// rule explicitly assigns another. The reviewer can still reassign or mark it
// "ignorée" afterwards from the transactions view.
function resolveDefaultCashflowId(db, householdId) {
  const defaultCashflow = db.prepare(
    'SELECT id FROM cashflows WHERE household_id = ? AND is_default = 1 AND is_archived = 0 LIMIT 1'
  ).get(householdId);
  return defaultCashflow ? defaultCashflow.id : null;
}

// Rules (deliberately configured by the household) always win. Otherwise, if the CSV
// itself carries category/subcategory columns, use those (creating the referential
// entries on the fly in commit mode) before falling back to the generic "Non affectée".
/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} householdId
 * @param {any} row
 * @param {{ create?: boolean }} [options]
 */
function categorizeRow(db, householdId, row, { create } = {}) {
  const rule = findMatchingRule(db, row.label, row.suggestedLabel, row.comment);
  const nature = rule?.nature || (row.amountCents >= 0 ? 'REVENUE' : 'EXPENSE');
  const defaultCashflowId = resolveDefaultCashflowId(db, householdId);
  if (rule && rule.category_id) {
    return { categoryId: rule.category_id, subcategoryId: rule.subcategory_id || null, cashflowId: rule.cashflow_id || defaultCashflowId, nature, source: 'RULE' };
  }
  if (row.sourceCategory) {
    const resolved = resolveCategoryFromSource(db, householdId, row.sourceCategory, row.sourceSubcategory, { create });
    if (resolved.categoryName) {
      return {
        categoryId: resolved.categoryId,
        subcategoryId: resolved.subcategoryId,
        cashflowId: defaultCashflowId,
        nature,
        source: 'CSV',
        categoryName: resolved.categoryName,
        subcategoryName: resolved.subcategoryName,
        categoryCreated: resolved.categoryCreated,
        subcategoryCreated: resolved.subcategoryCreated
      };
    }
  }
  const fallbackCategory = db.prepare('SELECT id FROM categories WHERE is_system = 1 LIMIT 1').get();
  const fallbackSubcategory = fallbackCategory
    ? db.prepare('SELECT id FROM subcategories WHERE category_id = ? AND is_system = 1 LIMIT 1').get(fallbackCategory.id)
    : null;
  return {
    categoryId: fallbackCategory ? fallbackCategory.id : null,
    subcategoryId: fallbackSubcategory ? fallbackSubcategory.id : null,
    cashflowId: defaultCashflowId,
    nature,
    source: 'DEFAULT'
  };
}

function checksum(csvText) {
  return crypto.createHash('sha256').update(String(csvText || '')).digest('hex');
}

module.exports = {
  FIELD_ALIASES,
  REQUIRED_FIELDS,
  splitLines,
  buildColumnMapping,
  mappingToHeaderNames,
  parseCsvStructure,
  evaluateRow,
  categorizeRow,
  resolveCategoryFromSource,
  resolveAccount,
  checksum
};
