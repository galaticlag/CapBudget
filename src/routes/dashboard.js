'use strict';

const { buildDashboardSummary, buildBudgetTypeSummary } = require('../services/dashboardService');

function parseListParam(value) {
  if (!value) return [];
  return String(value).split(',').map((v) => v.trim()).filter(Boolean);
}

async function dashboardRoutes(app) {
  app.get('/api/dashboard/summary', async (request) => {
    const { startMonth, endMonth, cashflowId, accountId, categoryIds, subcategoryIds } = request.query;
    return buildDashboardSummary(request.householdDb, {
      startMonth,
      endMonth,
      cashflowId,
      accountId,
      categoryIds: parseListParam(categoryIds),
      subcategoryIds: parseListParam(subcategoryIds)
    });
  });

  app.get('/api/dashboard/budget-types', async (request) => {
    const { startMonth, endMonth, cashflowId, accountId } = request.query;
    return buildBudgetTypeSummary(request.householdDb, { startMonth, endMonth, cashflowId, accountId });
  });
}

module.exports = dashboardRoutes;
