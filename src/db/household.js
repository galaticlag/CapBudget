// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { householdsDir } = require('../config');
const { newId } = require('../util/ids');
const { db: coreDb } = require('./core');

fs.mkdirSync(householdsDir, { recursive: true });

// Connection cache keyed by householdId. The on-disk path is always resolved
// from households.database_key in core.sqlite — never from client input.
const connections = new Map();

function resolveHousehold(householdId) {
  const row = coreDb.prepare('SELECT id, database_key, is_active FROM households WHERE id = ?').get(householdId);
  if (!row) return null;
  return row;
}

function ensureHouseholdSchema(db) {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      bank_account_reference_encrypted TEXT NOT NULL,
      bank_account_reference_masked TEXT NOT NULL,
      bank_account_reference_lookup TEXT NOT NULL,
      bank_account_label TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      archived_at TEXT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_lookup ON accounts(bank_account_reference_lookup);

    CREATE TABLE IF NOT EXISTS cashflows (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NULL,
      color TEXT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      archived_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS budget_types (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      percentage INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS household_objectives (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NULL,
      target_month TEXT NOT NULL,
      budget_type_id TEXT NOT NULL REFERENCES budget_types(id),
      percentage INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('REVENUE','EXPENSE')),
      color TEXT NULL,
      icon TEXT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      budget_type_id TEXT NULL REFERENCES budget_types(id),
      exclude_from_dashboard INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS subcategories (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL,
      color TEXT NULL,
      icon TEXT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      budget_type_id TEXT NULL REFERENCES budget_types(id)
    );

    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_checksum TEXT NOT NULL,
      mapping_definition_json TEXT NOT NULL,
      imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      imported_by_user_id TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      potential_duplicate_count INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      source_file_retention TEXT NOT NULL DEFAULT 'DELETE_AFTER_IMPORT' CHECK(source_file_retention IN ('KEEP','DELETE_AFTER_IMPORT')),
      cancelled_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS raw_import_rows (
      id TEXT PRIMARY KEY,
      import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
      row_number INTEGER NOT NULL,
      raw_payload_json TEXT NOT NULL,
      parse_status TEXT NOT NULL CHECK(parse_status IN ('IMPORTED','DUPLICATE','POTENTIAL_DUPLICATE','ERROR')),
      error_message TEXT NULL,
      transaction_id TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      account_id TEXT NULL REFERENCES accounts(id),
      import_batch_id TEXT NULL REFERENCES import_batches(id),
      operation_date TEXT NOT NULL,
      value_date TEXT NULL,
      raw_label TEXT NOT NULL,
      suggested_label TEXT NULL,
      amount_cents INTEGER NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'EUR',
      balance_after_cents INTEGER NULL,
      comment TEXT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id),
      subcategory_id TEXT NULL REFERENCES subcategories(id),
      cashflow_id TEXT NULL REFERENCES cashflows(id),
      nature TEXT NOT NULL CHECK(nature IN ('REVENUE','EXPENSE','TRANSFER')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      source TEXT NOT NULL CHECK(source IN ('IMPORT','MANUAL')),
      source_fingerprint TEXT NULL,
      is_manually_edited INTEGER NOT NULL DEFAULT 0,
      excluded_from_cashflow INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_by_user_id TEXT NULL,
      updated_by_user_id TEXT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_fingerprint ON transactions(source_fingerprint) WHERE source_fingerprint IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(operation_date);
    CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);

    CREATE TABLE IF NOT EXISTS categorization_rules (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      name TEXT NOT NULL,
      match_field TEXT NOT NULL CHECK(match_field IN ('RAW_LABEL','SUGGESTED_LABEL')),
      match_type TEXT NOT NULL CHECK(match_type IN ('CONTAINS','EQUALS','REGEX')),
      match_value TEXT NOT NULL,
      category_id TEXT NULL REFERENCES categories(id),
      subcategory_id TEXT NULL REFERENCES subcategories(id),
      cashflow_id TEXT NULL REFERENCES cashflows(id),
      nature TEXT NULL CHECK(nature IN ('REVENUE','EXPENSE','TRANSFER')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS household_audit_logs (
      id TEXT PRIMARY KEY,
      household_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NULL,
      old_value TEXT NULL,
      new_value TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS household_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  // Migration guard: add columns introduced after initial release to already-created databases.
  const categoryColumns = db.prepare("PRAGMA table_info(categories)").all().map((col) => col.name);
  if (!categoryColumns.includes('exclude_from_dashboard')) {
    db.exec('ALTER TABLE categories ADD COLUMN exclude_from_dashboard INTEGER NOT NULL DEFAULT 0');
  }

  const transactionColumns = db.prepare("PRAGMA table_info(transactions)").all().map((col) => col.name);
  if (!transactionColumns.includes('excluded_from_cashflow')) {
    db.exec('ALTER TABLE transactions ADD COLUMN excluded_from_cashflow INTEGER NOT NULL DEFAULT 0');
  }

  // Rules used to match a single field (match_field). Bulk categorization is easier when a
  // rule can match against any combination of raw label / suggested label / comment at once,
  // so these flags replace match_field as the source of truth (match_field is kept only to
  // satisfy the legacy NOT NULL/CHECK constraint on already-created databases).
  const ruleColumns = db.prepare("PRAGMA table_info(categorization_rules)").all().map((col) => col.name);
  if (!ruleColumns.includes('match_raw_label')) {
    db.exec(`
      ALTER TABLE categorization_rules ADD COLUMN match_raw_label INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE categorization_rules ADD COLUMN match_suggested_label INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE categorization_rules ADD COLUMN match_comment INTEGER NOT NULL DEFAULT 0;
    `);
    db.exec(`UPDATE categorization_rules SET match_raw_label = 1 WHERE match_field = 'RAW_LABEL'`);
    db.exec(`UPDATE categorization_rules SET match_suggested_label = 1 WHERE match_field = 'SUGGESTED_LABEL'`);
    // Any row that ends up with no field selected (shouldn't happen) falls back to raw label.
    db.exec(`UPDATE categorization_rules SET match_raw_label = 1 WHERE match_raw_label = 0 AND match_suggested_label = 0 AND match_comment = 0`);
  }

  mergeDuplicateCategoriesByName(db);
}

// Categories/subcategories used to be scoped separately per REVENUE/EXPENSE "kind" (e.g. the
// CSV importer would create a distinct "Assurance" row for each), which fragmented the
// referentials into confusing duplicates. Kind is no longer used to gate anything; this
// idempotent pass merges any active category/subcategory sharing the same name (case-
// insensitive) into a single surviving row, repointing transactions/rules accordingly.
function mergeDuplicateCategoriesByName(db) {
  const categories = db.prepare('SELECT * FROM categories WHERE is_active = 1').all();
  const groups = new Map();
  for (const c of categories) {
    const key = c.name.trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  // Prefer the row that already carries a budget type, then EXPENSE, then lowest id (deterministic).
  const pickSurvivor = (rows) => rows.slice().sort((a, b) => {
    if (Boolean(a.budget_type_id) !== Boolean(b.budget_type_id)) return a.budget_type_id ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'EXPENSE' ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  })[0];

  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const survivor = pickSurvivor(rows);
    for (const loser of rows) {
      if (loser.id !== survivor.id) mergeCategoryInto(db, loser, survivor);
    }
  }
}

function mergeSubcategoryInto(db, loser, survivor) {
  db.prepare('UPDATE transactions SET subcategory_id = ? WHERE subcategory_id = ?').run(survivor.id, loser.id);
  db.prepare('UPDATE categorization_rules SET subcategory_id = ? WHERE subcategory_id = ?').run(survivor.id, loser.id);
  db.prepare('DELETE FROM subcategories WHERE id = ?').run(loser.id);
}

function mergeCategoryInto(db, loser, survivor) {
  const loserSubs = db.prepare('SELECT * FROM subcategories WHERE category_id = ? AND is_active = 1').all(loser.id);
  for (const sub of loserSubs) {
    const match = db.prepare(
      'SELECT * FROM subcategories WHERE category_id = ? AND is_active = 1 AND lower(name) = lower(?)'
    ).get(survivor.id, sub.name);
    if (match) {
      mergeSubcategoryInto(db, sub, match);
    } else {
      db.prepare('UPDATE subcategories SET category_id = ? WHERE id = ?').run(survivor.id, sub.id);
    }
  }
  db.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').run(survivor.id, loser.id);
  db.prepare('UPDATE categorization_rules SET category_id = ? WHERE category_id = ?').run(survivor.id, loser.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(loser.id);
}

function openHouseholdDb(databaseKey) {
  const filePath = path.join(householdsDir, `${databaseKey}.sqlite`);
  const db = new DatabaseSync(filePath);
  ensureHouseholdSchema(db);
  return db;
}

// Only entry point used by routes/services to reach a household's data file.
function getHouseholdDb(householdId) {
  if (connections.has(householdId)) return connections.get(householdId);
  const household = resolveHousehold(householdId);
  if (!household) return null;
  const db = openHouseholdDb(household.database_key);
  connections.set(householdId, db);
  return db;
}

function createHouseholdDatabase(householdId) {
  const household = resolveHousehold(householdId);
  if (!household) throw new Error('Household not found');
  const db = openHouseholdDb(household.database_key);
  connections.set(householdId, db);
  return db;
}

// Evicts a household's cached connection (e.g. before its file is overwritten
// by a restore) so the next getHouseholdDb() call reopens the file fresh.
function closeHouseholdConnection(householdId) {
  const existing = connections.get(householdId);
  if (existing) {
    try { existing.close(); } catch { /* already closed */ }
    connections.delete(householdId);
  }
}

// Used to roll back a household creation that failed mid-seed: closes the
// connection and removes the sqlite file (+ WAL/SHM sidecars) it just created.
function deleteHouseholdDatabase(householdId, databaseKey) {
  closeHouseholdConnection(householdId);
  const filePath = path.join(householdsDir, `${databaseKey}.sqlite`);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${filePath}${suffix}`); } catch { /* file may not exist */ }
  }
}

module.exports = { getHouseholdDb, createHouseholdDatabase, deleteHouseholdDatabase, closeHouseholdConnection };
