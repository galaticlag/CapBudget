'use strict';

const { newId } = require('../util/ids');
const { db: coreDb } = require('../db/core');

const BUDGET_TYPE_DEFAULTS = [
  { key: 'essentials', name: 'Besoins essentiels', color: '#22c55e', percentage: 50 },
  { key: 'wants', name: 'Envies / Loisirs', color: '#f59e0b', percentage: 30 },
  { key: 'savings', name: 'Épargne', color: '#06b6d4', percentage: 20 }
];

// Populates a freshly created household database with the mandatory system
// categories, default budget split and default cashflow required by the spec.
function seedHouseholdDatabase(db, householdId) {
  const budgetTypeIdByKey = new Map();
  const insertBudgetType = db.prepare(`
    INSERT INTO budget_types (id, household_id, name, color, percentage, is_default, is_active, display_order)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?)
  `);
  BUDGET_TYPE_DEFAULTS.forEach((bt, index) => {
    const id = newId('budgettype');
    insertBudgetType.run(id, householdId, bt.name, bt.color, bt.percentage, index);
    budgetTypeIdByKey.set(bt.key, id);
  });

  db.prepare(`
    INSERT INTO cashflows (id, household_id, name, description, color, is_default, is_archived)
    VALUES (?, ?, 'Budget principal', 'Cashflow par défaut du foyer', '#2563eb', 1, 0)
  `).run(newId('cashflow'), householdId);

  // System "Non affectée" fallback category/subcategory, shared by both revenue and
  // expense transactions (categories are no longer split per nature).
  const catId = newId('cat');
  db.prepare(`
    INSERT INTO categories (id, household_id, name, kind, color, icon, display_order, is_system, is_active)
    VALUES (?, ?, 'Non affectée', 'EXPENSE', '#94a3b8', '❓', 999, 1, 1)
  `).run(catId, householdId);
  db.prepare(`
    INSERT INTO subcategories (id, household_id, category_id, name, color, icon, display_order, is_system, is_active)
    VALUES (?, ?, ?, 'Non affectée', '#94a3b8', '❓', 0, 1, 1)
  `).run(newId('sub'), householdId, catId);

  // Copy the admin-managed global catalog as a personalizable starting point.
  const catalogRows = coreDb.prepare('SELECT * FROM global_catalog ORDER BY parent_id IS NOT NULL, display_order').all();
  const categoryIdByGlobalId = new Map();
  const insertCategory = db.prepare(`
    INSERT INTO categories (id, household_id, name, kind, color, icon, display_order, is_system, is_active, budget_type_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
  `);
  const insertSubcategory = db.prepare(`
    INSERT INTO subcategories (id, household_id, category_id, name, color, icon, display_order, is_system, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
  `);

  for (const row of catalogRows.filter((r) => !r.parent_id)) {
    const localId = newId('cat');
    const budgetTypeId = row.budget_type_key ? budgetTypeIdByKey.get(row.budget_type_key) || null : null;
    insertCategory.run(localId, householdId, row.name, row.kind, row.color, row.icon, row.display_order, budgetTypeId);
    categoryIdByGlobalId.set(row.id, localId);
  }
  for (const row of catalogRows.filter((r) => r.parent_id)) {
    const localCategoryId = categoryIdByGlobalId.get(row.parent_id);
    if (!localCategoryId) continue;
    insertSubcategory.run(newId('sub'), householdId, localCategoryId, row.name, row.color, row.icon, row.display_order);
  }
}

module.exports = { seedHouseholdDatabase, BUDGET_TYPE_DEFAULTS };
