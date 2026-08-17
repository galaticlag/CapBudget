// @ts-check
'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { dataDir, coreDbPath } = require('../config');
const { newId } = require('../util/ids');

fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(coreDbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('ADMIN','MEMBER')),
      theme_preference TEXT NOT NULL DEFAULT 'SYSTEM' CHECK(theme_preference IN ('SYSTEM','LIGHT','DARK','HIGH_CONTRAST')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_login_at TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'EUR',
      database_key TEXT UNIQUE NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS household_memberships (
      household_id TEXT NOT NULL REFERENCES households(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_by_admin_id TEXT NULL REFERENCES users(id),
      PRIMARY KEY(household_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS global_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS global_catalog (
      id TEXT PRIMARY KEY,
      parent_id TEXT NULL REFERENCES global_catalog(id),
      name TEXT NOT NULL,
      kind TEXT NULL CHECK(kind IN ('REVENUE','EXPENSE')),
      color TEXT NULL,
      icon TEXT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      budget_type_key TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS global_import_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mapping_definition_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      created_by_user_id TEXT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS global_audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NULL,
      old_value TEXT NULL,
      new_value TEXT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON household_memberships(user_id);
  `);

  // Migration guard: add columns introduced after initial release to already-created databases.
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((col) => col.name);
  if (!userColumns.includes('sankey_detail_level')) {
    db.exec("ALTER TABLE users ADD COLUMN sankey_detail_level TEXT NOT NULL DEFAULT 'BALANCED'");
  }
}

function ensureSeedCatalog() {
  const row = /** @type {{ n: number }} */ (db.prepare('SELECT COUNT(*) AS n FROM global_catalog').get());
  if (row.n > 0) return;

  const insertCat = db.prepare(`
    INSERT INTO global_catalog (id, parent_id, name, kind, color, icon, display_order, budget_type_key)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?)
  `);
  const insertSub = db.prepare(`
    INSERT INTO global_catalog (id, parent_id, name, kind, color, icon, display_order, budget_type_key)
    VALUES (?, ?, ?, NULL, ?, ?, ?, NULL)
  `);

  const catalog = [
    { name: 'Salaire', kind: 'REVENUE', color: '#22c55e', icon: '💶', budgetType: null, subs: ['Salaire principal', 'Salaire secondaire'] },
    { name: 'Remboursements', kind: 'REVENUE', color: '#06b6d4', icon: '↩️', budgetType: null, subs: ['Assurance', 'Autres remboursements'] },
    { name: 'Logement', kind: 'EXPENSE', color: '#f97316', icon: '🏠', budgetType: 'essentials', subs: ['Loyer / Crédit', 'Charges', 'Énergie'] },
    { name: 'Alimentation', kind: 'EXPENSE', color: '#eab308', icon: '🛒', budgetType: 'essentials', subs: ['Courses', 'Restaurant'] },
    { name: 'Transport', kind: 'EXPENSE', color: '#3b82f6', icon: '🚗', budgetType: 'essentials', subs: ['Carburant', 'Transports en commun', 'Entretien'] },
    { name: 'Santé', kind: 'EXPENSE', color: '#ef4444', icon: '💊', budgetType: 'essentials', subs: ['Pharmacie', 'Consultations'] },
    { name: 'Loisir', kind: 'EXPENSE', color: '#a855f7', icon: '🎉', budgetType: 'wants', subs: ['Sorties', 'Abonnements loisirs', 'Voyages'] },
    { name: 'Investissement / Crypto', kind: 'EXPENSE', color: '#14b8a6', icon: '📈', budgetType: 'savings', subs: ['Bourse', 'Crypto-monnaies'] },
    { name: 'Épargne', kind: 'EXPENSE', color: '#0ea5e9', icon: '🏦', budgetType: 'savings', subs: ['Livret', "Plan d'épargne"] }
  ];

  let order = 0;
  for (const cat of catalog) {
    const catId = newId('gcat');
    insertCat.run(catId, cat.name, cat.kind, cat.color, cat.icon, order, cat.budgetType);
    order += 1;
    let subOrder = 0;
    for (const subName of cat.subs) {
      insertSub.run(newId('gsub'), catId, subName, cat.color, cat.icon, subOrder);
      subOrder += 1;
    }
  }
}

function ensureSeedSettings() {
  const defaults = {
    available_themes: JSON.stringify(['SYSTEM', 'LIGHT', 'DARK', 'HIGH_CONTRAST']),
    max_csv_upload_bytes: String(5 * 1024 * 1024),
    session_ttl_days: '30'
  };
  const insert = db.prepare(`
    INSERT INTO global_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, value);
  }
}

ensureSchema();
ensureSeedCatalog();
ensureSeedSettings();

module.exports = { db };
