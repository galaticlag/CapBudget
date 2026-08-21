// @ts-check
'use strict';

const { newId } = require('../util/ids');
const { logHouseholdAudit } = require('../services/auditService');
const { db: coreDb } = require('../db/core');
const { getBudgetStartDay, setBudgetStartDay } = require('../db/household');
const { MIN_BUDGET_START_DAY, MAX_BUDGET_START_DAY } = require('../util/budgetMonth');

function getSystemCategoryId(db) {
  const row = db.prepare('SELECT id FROM categories WHERE is_system = 1 LIMIT 1').get();
  return row ? row.id : null;
}

function getSystemSubcategoryId(db, categoryId) {
  const row = db.prepare('SELECT id FROM subcategories WHERE category_id = ? AND is_system = 1 LIMIT 1').get(categoryId);
  return row ? row.id : null;
}

async function referentialRoutes(app) {
  // ---- Accounts (read + archive only; creation happens during CSV import) ----
  app.get('/api/accounts', async (request) => {
    const rows = request.householdDb.prepare(
      'SELECT id, bank_account_reference_masked, bank_account_label, is_archived, created_at, archived_at FROM accounts ORDER BY created_at'
    ).all();
    return rows.map((r) => ({
      id: r.id,
      referenceMasked: r.bank_account_reference_masked,
      label: r.bank_account_label,
      isArchived: Boolean(r.is_archived),
      createdAt: r.created_at,
      archivedAt: r.archived_at
    }));
  });

  app.put('/api/accounts/:id/archive', async (request, reply) => {
    const { id } = request.params;
    const account = request.householdDb.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    if (!account) {
      reply.code(404);
      return { error: 'Compte introuvable.' };
    }
    request.householdDb.prepare(
      "UPDATE accounts SET is_archived = 1, archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
    ).run(id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'ARCHIVE', 'account', id, { isArchived: false }, { isArchived: true });
    return { ok: true };
  });

  // ---- Cashflows ----
  app.get('/api/cashflows', async (request) => {
    return request.householdDb.prepare('SELECT * FROM cashflows ORDER BY is_archived, is_default DESC, name').all();
  });

  app.post('/api/cashflows', async (request, reply) => {
    const { name, description, color } = request.body || {};
    if (!name || !String(name).trim()) {
      reply.code(400);
      return { error: 'Nom du cashflow requis.' };
    }
    const id = newId('cashflow');
    request.householdDb.prepare(`
      INSERT INTO cashflows (id, household_id, name, description, color, is_default, is_archived)
      VALUES (?, ?, ?, ?, ?, 0, 0)
    `).run(id, request.householdId, String(name).trim(), description || null, color || '#3b82f6');
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'CREATE', 'cashflow', id, null, { name, description, color });
    reply.code(201);
    return { id };
  });

  app.put('/api/cashflows/:id', async (request, reply) => {
    const { id } = request.params;
    const cashflow = request.householdDb.prepare('SELECT * FROM cashflows WHERE id = ?').get(id);
    if (!cashflow) {
      reply.code(404);
      return { error: 'Cashflow introuvable.' };
    }
    const { name, description, color, isArchived } = request.body || {};
    const next = {
      name: name !== undefined ? String(name).trim() : cashflow.name,
      description: description !== undefined ? description : cashflow.description,
      color: color !== undefined ? color : cashflow.color,
      isArchived: typeof isArchived === 'boolean' ? (isArchived ? 1 : 0) : cashflow.is_archived
    };
    if (next.isArchived && cashflow.is_default) {
      reply.code(409);
      return { error: 'Le cashflow par défaut ne peut pas être archivé.' };
    }
    request.householdDb.prepare(
      "UPDATE cashflows SET name = ?, description = ?, color = ?, is_archived = ?, archived_at = CASE WHEN ? = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE archived_at END WHERE id = ?"
    ).run(next.name, next.description, next.color, next.isArchived, next.isArchived, id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'cashflow', id, cashflow, next);
    return { ok: true };
  });

  app.put('/api/cashflows/:id/set-default', async (request, reply) => {
    const { id } = request.params;
    const cashflow = request.householdDb.prepare('SELECT * FROM cashflows WHERE id = ? AND is_archived = 0').get(id);
    if (!cashflow) {
      reply.code(404);
      return { error: 'Cashflow introuvable ou archivé.' };
    }
    request.householdDb.prepare('UPDATE cashflows SET is_default = 0');
    request.householdDb.prepare('UPDATE cashflows SET is_default = 1 WHERE id = ?').run(id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'cashflow', id, null, { isDefault: true });
    return { ok: true };
  });

  // ---- Categories ----
  app.get('/api/categories', async (request) => {
    return request.householdDb.prepare(`
      SELECT c.*, bt.name AS budget_type_name, bt.color AS budget_type_color
      FROM categories c LEFT JOIN budget_types bt ON bt.id = c.budget_type_id
      ORDER BY c.is_system, c.display_order, c.name
    `).all();
  });

  app.post('/api/categories', async (request, reply) => {
    const { name, color, icon, displayOrder, budgetTypeId, excludeFromDashboard } = request.body || {};
    if (!name || !String(name).trim()) {
      reply.code(400);
      return { error: 'Nom requis.' };
    }
    // Categories are no longer scoped to a single revenue/expense "kind" (a category can be
    // used by either); the column is kept for backward compatibility but no longer enforced.
    const effectiveBudgetTypeId = budgetTypeId || null;
    const effectiveExcludeFromDashboard = excludeFromDashboard ? 1 : 0;
    const id = newId('cat');
    request.householdDb.prepare(`
      INSERT INTO categories (id, household_id, name, kind, color, icon, display_order, is_system, is_active, budget_type_id, exclude_from_dashboard)
      VALUES (?, ?, ?, 'EXPENSE', ?, ?, ?, 0, 1, ?, ?)
    `).run(id, request.householdId, String(name).trim(), color || null, icon || null, displayOrder || 0, effectiveBudgetTypeId, effectiveExcludeFromDashboard);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'CREATE', 'category', id, null, { name, color, icon, budgetTypeId: effectiveBudgetTypeId, excludeFromDashboard: effectiveExcludeFromDashboard });
    reply.code(201);
    return { id };
  });

  app.put('/api/categories/:id', async (request, reply) => {
    const { id } = request.params;
    const category = request.householdDb.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!category) {
      reply.code(404);
      return { error: 'Catégorie introuvable.' };
    }
    if (category.is_system) {
      reply.code(409);
      return { error: 'La catégorie système ne peut pas être modifiée.' };
    }
    const { name, color, icon, displayOrder, budgetTypeId, isActive, excludeFromDashboard } = request.body || {};
    const nextBudgetTypeId = budgetTypeId !== undefined ? (budgetTypeId || null) : category.budget_type_id;
    const next = {
      name: name !== undefined ? String(name).trim() : category.name,
      color: color !== undefined ? color : category.color,
      icon: icon !== undefined ? icon : category.icon,
      display_order: displayOrder !== undefined ? displayOrder : category.display_order,
      budget_type_id: nextBudgetTypeId,
      is_active: typeof isActive === 'boolean' ? (isActive ? 1 : 0) : category.is_active,
      exclude_from_dashboard: typeof excludeFromDashboard === 'boolean' ? (excludeFromDashboard ? 1 : 0) : category.exclude_from_dashboard
    };
    request.householdDb.prepare(
      'UPDATE categories SET name = ?, color = ?, icon = ?, display_order = ?, budget_type_id = ?, is_active = ?, exclude_from_dashboard = ? WHERE id = ?'
    ).run(next.name, next.color, next.icon, next.display_order, next.budget_type_id, next.is_active, next.exclude_from_dashboard, id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'category', id, category, next);
    return { ok: true };
  });

  app.get('/api/categories/:id/delete-preview', async (request, reply) => {
    const { id } = request.params;
    const category = request.householdDb.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!category) {
      reply.code(404);
      return { error: 'Catégorie introuvable.' };
    }
    const txCount = request.householdDb.prepare('SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?').get(id)?.n || 0;
    const ruleCount = request.householdDb.prepare('SELECT COUNT(*) AS n FROM categorization_rules WHERE category_id = ?').get(id)?.n || 0;
    const subcategoryCount = request.householdDb.prepare('SELECT COUNT(*) AS n FROM subcategories WHERE category_id = ?').get(id)?.n || 0;
    return { ok: true, impactedTransactions: txCount, impactedRules: ruleCount, subcategoriesToDelete: subcategoryCount };
  });

  app.delete('/api/categories/:id', async (request, reply) => {
    const { id } = request.params;
    const category = request.householdDb.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!category) {
      reply.code(404);
      return { error: 'Catégorie introuvable.' };
    }
    if (category.is_system) {
      reply.code(409);
      return { error: 'La catégorie système ne peut pas être supprimée.' };
    }
    const { replacementCategoryId, replacementSubcategoryId } = request.body || {};
    let targetCategoryId = null;
    let targetSubcategoryId = null;
    if (replacementCategoryId) {
      const targetCategory = request.householdDb.prepare('SELECT * FROM categories WHERE id = ?').get(replacementCategoryId);
      if (!targetCategory) {
        reply.code(400);
        return { error: 'Catégorie de remplacement introuvable.' };
      }
      if (targetCategory.id === id) {
        reply.code(400);
        return { error: 'La catégorie de remplacement doit être différente.' };
      }
      targetCategoryId = targetCategory.id;
      if (replacementSubcategoryId) {
        const targetSubcategory = request.householdDb.prepare('SELECT * FROM subcategories WHERE id = ?').get(replacementSubcategoryId);
        if (!targetSubcategory || targetSubcategory.category_id !== targetCategoryId) {
          reply.code(400);
          return { error: 'Sous-catégorie de remplacement invalide.' };
        }
        targetSubcategoryId = targetSubcategory.id;
      } else {
        targetSubcategoryId = getSystemSubcategoryId(request.householdDb, targetCategoryId) || null;
      }
    } else {
      const fallbackCategoryId = getSystemCategoryId(request.householdDb);
      targetCategoryId = fallbackCategoryId;
      targetSubcategoryId = fallbackCategoryId ? (getSystemSubcategoryId(request.householdDb, fallbackCategoryId) || null) : null;
    }
    request.householdDb.prepare(
      'UPDATE transactions SET category_id = ?, subcategory_id = ? WHERE category_id = ?'
    ).run(targetCategoryId, targetSubcategoryId, id);
    request.householdDb.prepare(
      'UPDATE categorization_rules SET category_id = ?, subcategory_id = ? WHERE category_id = ?'
    ).run(targetCategoryId, targetSubcategoryId, id);
    request.householdDb.prepare('DELETE FROM subcategories WHERE category_id = ?').run(id);
    request.householdDb.prepare('DELETE FROM categories WHERE id = ?').run(id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'DELETE', 'category', id, category, { reassignedTo: targetCategoryId, reassignedSubcategoryTo: targetSubcategoryId });
    return { ok: true };
  });

  // ---- Subcategories ----
  app.get('/api/subcategories', async (request) => {
    return request.householdDb.prepare('SELECT * FROM subcategories ORDER BY is_system, display_order, name').all();
  });

  app.post('/api/subcategories', async (request, reply) => {
    const { categoryId, name, color, icon, displayOrder, budgetTypeId } = request.body || {};
    const category = request.householdDb.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
    if (!category || !name || !String(name).trim()) {
      reply.code(400);
      return { error: 'Catégorie et nom requis.' };
    }
    const effectiveBudgetTypeId = budgetTypeId || null;
    const id = newId('sub');
    request.householdDb.prepare(`
      INSERT INTO subcategories (id, household_id, category_id, name, color, icon, display_order, is_system, is_active, budget_type_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
    `).run(id, request.householdId, categoryId, String(name).trim(), color || null, icon || null, displayOrder || 0, effectiveBudgetTypeId);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'CREATE', 'subcategory', id, null, { categoryId, name, color, icon, budgetTypeId: effectiveBudgetTypeId });
    reply.code(201);
    return { id };
  });

  app.put('/api/subcategories/:id', async (request, reply) => {
    const { id } = request.params;
    const subcategory = request.householdDb.prepare('SELECT * FROM subcategories WHERE id = ?').get(id);
    if (!subcategory) {
      reply.code(404);
      return { error: 'Sous-catégorie introuvable.' };
    }
    if (subcategory.is_system) {
      reply.code(409);
      return { error: 'La sous-catégorie système ne peut pas être modifiée.' };
    }
    const { name, color, icon, displayOrder, budgetTypeId, isActive } = request.body || {};
    const nextBudgetTypeId = budgetTypeId !== undefined ? (budgetTypeId || null) : subcategory.budget_type_id;
    const next = {
      name: name !== undefined ? String(name).trim() : subcategory.name,
      color: color !== undefined ? color : subcategory.color,
      icon: icon !== undefined ? icon : subcategory.icon,
      display_order: displayOrder !== undefined ? displayOrder : subcategory.display_order,
      budget_type_id: nextBudgetTypeId,
      is_active: typeof isActive === 'boolean' ? (isActive ? 1 : 0) : subcategory.is_active
    };
    request.householdDb.prepare(
      'UPDATE subcategories SET name = ?, color = ?, icon = ?, display_order = ?, budget_type_id = ?, is_active = ? WHERE id = ?'
    ).run(next.name, next.color, next.icon, next.display_order, next.budget_type_id, next.is_active, id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'subcategory', id, subcategory, next);
    return { ok: true };
  });

  app.get('/api/subcategories/:id/delete-preview', async (request, reply) => {
    const { id } = request.params;
    const subcategory = request.householdDb.prepare('SELECT * FROM subcategories WHERE id = ?').get(id);
    if (!subcategory) {
      reply.code(404);
      return { error: 'Sous-catégorie introuvable.' };
    }
    const txCount = request.householdDb.prepare('SELECT COUNT(*) AS n FROM transactions WHERE subcategory_id = ?').get(id)?.n || 0;
    const ruleCount = request.householdDb.prepare('SELECT COUNT(*) AS n FROM categorization_rules WHERE subcategory_id = ?').get(id)?.n || 0;
    return { ok: true, impactedTransactions: txCount, impactedRules: ruleCount };
  });

  app.delete('/api/subcategories/:id', async (request, reply) => {
    const { id } = request.params;
    const subcategory = request.householdDb.prepare('SELECT * FROM subcategories WHERE id = ?').get(id);
    if (!subcategory) {
      reply.code(404);
      return { error: 'Sous-catégorie introuvable.' };
    }
    if (subcategory.is_system) {
      reply.code(409);
      return { error: 'La sous-catégorie système ne peut pas être supprimée.' };
    }
    const { replacementSubcategoryId } = request.body || {};
    let targetSubcategoryId = null;
    if (replacementSubcategoryId) {
      const targetSubcategory = request.householdDb.prepare('SELECT * FROM subcategories WHERE id = ?').get(replacementSubcategoryId);
      if (!targetSubcategory) {
        reply.code(400);
        return { error: 'Sous-catégorie de remplacement introuvable.' };
      }
      if (targetSubcategory.id === id) {
        reply.code(400);
        return { error: 'La sous-catégorie de remplacement doit être différente.' };
      }
      if (targetSubcategory.category_id !== subcategory.category_id) {
        reply.code(400);
        return { error: 'La sous-catégorie de remplacement doit appartenir à la même catégorie.' };
      }
      targetSubcategoryId = targetSubcategory.id;
    } else {
      targetSubcategoryId = getSystemSubcategoryId(request.householdDb, subcategory.category_id);
    }
    request.householdDb.prepare('UPDATE transactions SET subcategory_id = ? WHERE subcategory_id = ?').run(targetSubcategoryId, id);
    request.householdDb.prepare('UPDATE categorization_rules SET subcategory_id = ? WHERE subcategory_id = ?').run(targetSubcategoryId, id);
    request.householdDb.prepare('DELETE FROM subcategories WHERE id = ?').run(id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'DELETE', 'subcategory', id, subcategory, { reassignedTo: targetSubcategoryId });
    return { ok: true };
  });

  // ---- Budget types ----
  app.get('/api/budget-types', async (request) => {
    const rows = request.householdDb.prepare('SELECT * FROM budget_types WHERE is_active = 1 ORDER BY display_order, name').all();
    const total = rows.reduce((sum, r) => (r.percentage > 0 ? sum + r.percentage : sum), 0);
    return { items: rows, percentageTotal: total, percentageWarning: total !== 100 };
  });

  app.post('/api/budget-types', async (request, reply) => {
    const { name, color, percentage, displayOrder } = request.body || {};
    if (!name || !String(name).trim() || !Number.isFinite(percentage)) {
      reply.code(400);
      return { error: 'Nom et pourcentage requis.' };
    }
    const id = newId('budgettype');
    request.householdDb.prepare(`
      INSERT INTO budget_types (id, household_id, name, color, percentage, is_default, is_active, display_order)
      VALUES (?, ?, ?, ?, ?, 0, 1, ?)
    `).run(id, request.householdId, String(name).trim(), color || '#64748b', percentage, displayOrder || 0);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'CREATE', 'budget_type', id, null, { name, color, percentage });
    reply.code(201);
    return { id };
  });

  app.put('/api/budget-types/:id', async (request, reply) => {
    const { id } = request.params;
    const budgetType = request.householdDb.prepare('SELECT * FROM budget_types WHERE id = ?').get(id);
    if (!budgetType) {
      reply.code(404);
      return { error: 'Type budgétaire introuvable.' };
    }
    const { name, color, percentage, displayOrder } = request.body || {};
    const next = {
      name: name !== undefined ? String(name).trim() : budgetType.name,
      color: color !== undefined ? color : budgetType.color,
      percentage: percentage !== undefined ? percentage : budgetType.percentage,
      display_order: displayOrder !== undefined ? displayOrder : budgetType.display_order
    };
    request.householdDb.prepare(
      'UPDATE budget_types SET name = ?, color = ?, percentage = ?, display_order = ? WHERE id = ?'
    ).run(next.name, next.color, next.percentage, next.display_order, id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'budget_type', id, budgetType, next);
    return { ok: true };
  });

  // Batched percentage save: a type with 0% is excluded from the 100% requirement
  // (e.g. "Frais pro" tracked without a target, overspend allowed).
  app.put('/api/budget-types/percentages', async (request, reply) => {
    const { updates } = request.body || {};
    if (!Array.isArray(updates) || updates.length === 0) {
      reply.code(400);
      return { error: 'Liste de pourcentages requise.' };
    }
    const activeTypes = request.householdDb.prepare('SELECT id, percentage FROM budget_types WHERE is_active = 1').all();
    const percentageById = new Map(activeTypes.map((t) => [t.id, t.percentage]));
    for (const u of updates) {
      if (!percentageById.has(u.id) || !Number.isFinite(u.percentage) || u.percentage < 0 || u.percentage > 100) {
        reply.code(400);
        return { error: 'Pourcentage invalide.' };
      }
      percentageById.set(u.id, u.percentage);
    }
    const total = Array.from(percentageById.values()).reduce((sum, p) => (p > 0 ? sum + p : sum), 0);
    if (total !== 100) {
      reply.code(400);
      return { error: `La somme des pourcentages (hors types à 0%) doit être égale à 100% (actuellement ${total}%).` };
    }
    const stmt = request.householdDb.prepare('UPDATE budget_types SET percentage = ? WHERE id = ?');
    for (const u of updates) {
      stmt.run(u.percentage, u.id);
    }
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'budget_type', null, null, { updates });
    return { ok: true };
  });

  app.delete('/api/budget-types/:id', async (request, reply) => {
    const { id } = request.params;
    const budgetType = request.householdDb.prepare('SELECT * FROM budget_types WHERE id = ?').get(id);
    if (!budgetType) {
      reply.code(404);
      return { error: 'Type budgétaire introuvable.' };
    }
    if (budgetType.is_default) {
      reply.code(409);
      return { error: 'Un type budgétaire par défaut ne peut pas être désactivé.' };
    }
    request.householdDb.prepare('UPDATE budget_types SET is_active = 0 WHERE id = ?').run(id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'ARCHIVE', 'budget_type', id, { isActive: true }, { isActive: false });
    return { ok: true };
  });

  // ---- Household objectives ----
  app.get('/api/objectives', async (request) => {
    return request.householdDb.prepare('SELECT * FROM household_objectives ORDER BY target_month DESC').all();
  });

  app.post('/api/objectives', async (request, reply) => {
    const { name, description, targetMonth, budgetTypeId, percentage } = request.body || {};
    if (!name || !targetMonth || !budgetTypeId || !Number.isFinite(percentage)) {
      reply.code(400);
      return { error: 'Nom, mois cible, type budgétaire et pourcentage requis.' };
    }
    const id = newId('objective');
    request.householdDb.prepare(`
      INSERT INTO household_objectives (id, household_id, name, description, target_month, budget_type_id, percentage, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(id, request.householdId, String(name).trim(), description || null, targetMonth, budgetTypeId, percentage);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'CREATE', 'objective', id, null, request.body);
    reply.code(201);
    return { id };
  });

  app.put('/api/objectives/:id', async (request, reply) => {
    const { id } = request.params;
    const objective = request.householdDb.prepare('SELECT * FROM household_objectives WHERE id = ?').get(id);
    if (!objective) {
      reply.code(404);
      return { error: 'Objectif introuvable.' };
    }
    const { name, description, targetMonth, budgetTypeId, percentage, isActive } = request.body || {};
    const next = {
      name: name !== undefined ? String(name).trim() : objective.name,
      description: description !== undefined ? description : objective.description,
      target_month: targetMonth !== undefined ? targetMonth : objective.target_month,
      budget_type_id: budgetTypeId !== undefined ? budgetTypeId : objective.budget_type_id,
      percentage: percentage !== undefined ? percentage : objective.percentage,
      is_active: typeof isActive === 'boolean' ? (isActive ? 1 : 0) : objective.is_active
    };
    request.householdDb.prepare(
      'UPDATE household_objectives SET name = ?, description = ?, target_month = ?, budget_type_id = ?, percentage = ?, is_active = ? WHERE id = ?'
    ).run(next.name, next.description, next.target_month, next.budget_type_id, next.percentage, next.is_active, id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'objective', id, objective, next);
    return { ok: true };
  });

  app.delete('/api/objectives/:id', async (request, reply) => {
    const { id } = request.params;
    const objective = request.householdDb.prepare('SELECT * FROM household_objectives WHERE id = ?').get(id);
    if (!objective) {
      reply.code(404);
      return { error: 'Objectif introuvable.' };
    }
    request.householdDb.prepare('DELETE FROM household_objectives WHERE id = ?').run(id);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'DELETE', 'objective', id, objective, null);
    return { ok: true };
  });

  // ---- Household self-management (MEMBER can rename their own household) ----
  app.put('/api/household', async (request, reply) => {
    const { name } = request.body || {};
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      reply.code(400);
      return { error: 'Nom du foyer requis.' };
    }
    if (trimmed.length > 100) {
      reply.code(400);
      return { error: 'Nom du foyer trop long (100 caract\u00e8res max).' };
    }
    const before = request.household.name;
    coreDb.prepare('UPDATE households SET name = ? WHERE id = ?').run(trimmed, request.householdId);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'household', request.householdId, { name: before }, { name: trimmed });
    return { ok: true, name: trimmed };
  });

  // Budget month start day: which day of the calendar month the household's "budget
  // month" begins on (e.g. salaries paid on the last days of the month should count
  // toward the FOLLOWING budget month rather than the one about to end).
  app.get('/api/household/settings', async (request) => {
    return { budgetStartDay: getBudgetStartDay(request.householdDb) };
  });

  app.put('/api/household/settings', async (request, reply) => {
    const { budgetStartDay } = request.body || {};
    const day = Number(budgetStartDay);
    if (!Number.isInteger(day) || day === 0 || day < MIN_BUDGET_START_DAY || day > MAX_BUDGET_START_DAY) {
      reply.code(400);
      return { error: `Jour de d\u00e9but du mois budg\u00e9taire invalide (entre ${MIN_BUDGET_START_DAY} et ${MAX_BUDGET_START_DAY}, hors 0).` };
    }
    const before = getBudgetStartDay(request.householdDb);
    const saved = setBudgetStartDay(request.householdDb, day);
    logHouseholdAudit(request.householdDb, request.householdId, request.user.id, 'UPDATE', 'household_settings', request.householdId, { budgetStartDay: before }, { budgetStartDay: saved });
    return { ok: true, budgetStartDay: saved };
  });
}

module.exports = referentialRoutes;
