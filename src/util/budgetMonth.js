// @ts-check
'use strict';

// The "budget month" lets a household start its monthly budget period on a day
// other than the 1st (e.g. salaries paid on the last days of the calendar month
// should count toward the FOLLOWING budget month, not get stranded in the one
// that's about to end). A month label like "2026-08" always names the calendar
// month the period STARTS in; with budgetStartDay=1 this is byte-identical to a
// plain calendar month (the pre-existing default behavior).
const MIN_BUDGET_START_DAY = 1;
const MAX_BUDGET_START_DAY = 28; // capped so every month (incl. February) has that day

/** @param {number|string|null|undefined} day */
function clampBudgetStartDay(day) {
  const n = Number(day);
  if (!Number.isInteger(n)) return MIN_BUDGET_START_DAY;
  return Math.min(MAX_BUDGET_START_DAY, Math.max(MIN_BUDGET_START_DAY, n));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

// Real [startDate, endDate] (inclusive, YYYY-MM-DD) calendar dates covered by
// budget-month `monthStr` ("YYYY-MM") given the household's start day.
/**
 * @param {string} monthStr
 * @param {number|string|null|undefined} budgetStartDay
 */
function budgetMonthToDateRange(monthStr, budgetStartDay) {
  const [y, m] = String(monthStr).split('-').map((v) => Number(v));
  const day = clampBudgetStartDay(budgetStartDay);
  const startDate = new Date(Date.UTC(y, m - 1, day));
  const endDate = new Date(Date.UTC(y, m, day));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return { startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) };
}

module.exports = { clampBudgetStartDay, budgetMonthToDateRange, MIN_BUDGET_START_DAY, MAX_BUDGET_START_DAY };
