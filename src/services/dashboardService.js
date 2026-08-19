// @ts-check
'use strict';

const { budgetMonthToDateRange } = require('../util/budgetMonth');

/**
 * @typedef {Object} DashboardFilters
 * @property {string} [startMonth]
 * @property {string} [endMonth]
 * @property {number} [budgetStartDay]
 * @property {string} [cashflowId]
 * @property {string} [accountId]
 * @property {string[]} [categoryIds]
 * @property {string[]} [subcategoryIds]
 */

/**
 * @param {string} [startMonth]
 * @param {string} [endMonth]
 * @param {number} [budgetStartDay]
 * @returns {{ clauses: string[], params: string[] }}
 */
function monthRangeClause(startMonth, endMonth, budgetStartDay) {
  const clauses = [];
  const params = [];
  if (startMonth) {
    clauses.push('t.operation_date >= ?');
    params.push(budgetMonthToDateRange(startMonth, budgetStartDay).startDate);
  }
  if (endMonth) {
    clauses.push('t.operation_date <= ?');
    params.push(budgetMonthToDateRange(endMonth, budgetStartDay).endDate);
  }
  return { clauses, params };
}

// Aggregates ACTIVE, non-TRANSFER transactions into a category > subcategory
// tree for the cashflow Sankey view. Zero-amount categories/subcategories are
// dropped entirely (never grouped into an "Autres" bucket), per spec.
/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {DashboardFilters} filters
 */
function buildDashboardSummary(db, filters) {
  const clauses = ["t.status = 'ACTIVE'", "t.nature != 'TRANSFER'", "(c.exclude_from_dashboard IS NULL OR c.exclude_from_dashboard = 0)", "t.excluded_from_cashflow = 0"];
  const params = [];

  const { clauses: monthClauses, params: monthParams } = monthRangeClause(filters.startMonth, filters.endMonth, filters.budgetStartDay);
  clauses.push(...monthClauses);
  params.push(...monthParams);

  if (filters.cashflowId) {
    clauses.push('t.cashflow_id = ?');
    params.push(filters.cashflowId);
  }
  if (filters.accountId) {
    clauses.push('t.account_id = ?');
    params.push(filters.accountId);
  }
  if (filters.categoryIds && filters.categoryIds.length > 0) {
    clauses.push(`t.category_id IN (${filters.categoryIds.map(() => '?').join(',')})`);
    params.push(...filters.categoryIds);
  }
  if (filters.subcategoryIds && filters.subcategoryIds.length > 0) {
    clauses.push(`t.subcategory_id IN (${filters.subcategoryIds.map(() => '?').join(',')})`);
    params.push(...filters.subcategoryIds);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT
      t.nature AS nature,
      t.category_id AS category_id, c.name AS category_name, c.display_order AS category_order, c.color AS category_color,
      t.subcategory_id AS subcategory_id, s.name AS subcategory_name, s.display_order AS subcategory_order,
      SUM(ABS(t.amount_cents)) AS amount_cents
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN subcategories s ON s.id = t.subcategory_id
    ${where}
    GROUP BY t.nature, t.category_id, t.subcategory_id
  `).all(...params);

  const totals = { revenueCents: 0, expenseCents: 0 };
  /** @type {{ REVENUE: Map<string, any>, EXPENSE: Map<string, any> }} */
  const trees = { REVENUE: new Map(), EXPENSE: new Map() };

  for (const row of /** @type {any[]} */ (rows)) {
    if (row.nature !== 'REVENUE' && row.nature !== 'EXPENSE') continue;
    if (row.nature === 'REVENUE') totals.revenueCents += row.amount_cents;
    else totals.expenseCents += row.amount_cents;

    const tree = trees[row.nature];
    if (!tree.has(row.category_id)) {
      tree.set(row.category_id, {
        categoryId: row.category_id,
        name: row.category_name || 'Non affectée',
        color: row.category_color,
        displayOrder: row.category_order ?? 0,
        amountCents: 0,
        subcategories: new Map()
      });
    }
    const categoryNode = tree.get(row.category_id);
    categoryNode.amountCents += row.amount_cents;
    if (row.subcategory_id) {
      if (!categoryNode.subcategories.has(row.subcategory_id)) {
        categoryNode.subcategories.set(row.subcategory_id, {
          subcategoryId: row.subcategory_id,
          name: row.subcategory_name || 'Non affectée',
          displayOrder: row.subcategory_order ?? 0,
          amountCents: 0
        });
      }
      categoryNode.subcategories.get(row.subcategory_id).amountCents += row.amount_cents;
    }
  }

  const toSortedArray = (tree) => Array.from(tree.values())
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((c) => ({
      ...c,
      subcategories: Array.from(c.subcategories.values()).sort((a, b) => a.displayOrder - b.displayOrder)
    }));

  return {
    totals: {
      revenueCents: totals.revenueCents,
      expenseCents: totals.expenseCents,
      remainingCents: totals.revenueCents - totals.expenseCents
    },
    revenue: toSortedArray(trees.REVENUE),
    expense: toSortedArray(trees.EXPENSE)
  };
}

// Compares the current EXPENSE split across budget types (Besoins essentiels /
// Envies-Loisirs / Épargne, plus any custom ones) against each type's target
// percentage, for the dashboard "target vs reality" widget.
/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {DashboardFilters} filters
 */
function buildBudgetTypeSummary(db, filters) {
  const clauses = ["t.status = 'ACTIVE'", "t.nature = 'EXPENSE'", "(c.exclude_from_dashboard IS NULL OR c.exclude_from_dashboard = 0)", "t.excluded_from_cashflow = 0"];
  const params = [];

  const { clauses: monthClauses, params: monthParams } = monthRangeClause(filters.startMonth, filters.endMonth, filters.budgetStartDay);
  clauses.push(...monthClauses);
  params.push(...monthParams);

  if (filters.cashflowId) {
    clauses.push('t.cashflow_id = ?');
    params.push(filters.cashflowId);
  }
  if (filters.accountId) {
    clauses.push('t.account_id = ?');
    params.push(filters.accountId);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT c.budget_type_id AS budget_type_id, SUM(ABS(t.amount_cents)) AS amount_cents
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    ${where}
    GROUP BY c.budget_type_id
  `).all(...params);

  /** @type {Map<string, number>} */
  const amountByBudgetTypeId = new Map();
  let totalExpenseCents = 0;
  let unassignedCents = 0;
  for (const row of /** @type {any[]} */ (rows)) {
    totalExpenseCents += row.amount_cents;
    if (row.budget_type_id) amountByBudgetTypeId.set(row.budget_type_id, row.amount_cents);
    else unassignedCents += row.amount_cents;
  }

  /** @type {import('../types').BudgetType[]} */
  const budgetTypes = /** @type {any} */ (db.prepare(
    'SELECT * FROM budget_types WHERE is_active = 1 ORDER BY display_order, name'
  ).all());

  const items = budgetTypes.map((bt) => {
    const amountCents = amountByBudgetTypeId.get(bt.id) || 0;
    const actualPercentage = totalExpenseCents > 0 ? (amountCents / totalExpenseCents) * 100 : 0;
    return {
      budgetTypeId: bt.id,
      name: bt.name,
      color: bt.color,
      targetPercentage: bt.percentage,
      amountCents,
      actualPercentage,
      variancePoints: actualPercentage - bt.percentage
    };
  });

  return {
    totalExpenseCents,
    unassignedCents,
    items
  };
}

module.exports = { buildDashboardSummary, buildBudgetTypeSummary };
