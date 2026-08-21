// @ts-check
'use strict';

// The "budget month" lets a household start its monthly budget period on a day
// other than the 1st (e.g. salaries paid on the last days of the calendar month
// should count toward the FOLLOWING budget month, not get stranded in the one
// that's about to end). A month label like "2026-08" always names the calendar
// month the period STARTS in; with budgetStartDay=1 this is byte-identical to a
// plain calendar month (the pre-existing default behavior).
//
// budgetStartDay is a signed "day encoding":
// - positive (1..28): the Nth day of that calendar month (fixed day-of-month,
//   e.g. a salary always paid on the 25th) — capped at 28 so it exists in
//   every month, including February.
// - negative (-1..-15): counts backward from the LAST day of that calendar
//   month (-1 = last day, -2 = second-to-last day, ...) — robust to months
//   having 28, 29, 30 or 31 days, for salaries paid on/near month-end.
const MIN_BUDGET_START_DAY = -15;
const MAX_BUDGET_START_DAY = 28;

/** @param {number|string|null|undefined} day */
function clampBudgetStartDay(day) {
  const n = Number(day);
  if (!Number.isInteger(n) || n === 0) return 1;
  return Math.min(MAX_BUDGET_START_DAY, Math.max(MIN_BUDGET_START_DAY, n));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

// Resolves the signed day encoding to an actual date within 1-indexed calendar
// `month` (may be <1 or >12 — JS Date rolls over into neighboring years).
function resolveEncodedDay(y, month, dayEncoding) {
  if (dayEncoding > 0) return new Date(Date.UTC(y, month - 1, dayEncoding));
  // Rolling the day param to 0 (or negative) walks backward from the 1st of
  // `month`, landing inside `month` itself — the "Nth-to-last day" we want.
  return new Date(Date.UTC(y, month, dayEncoding + 1));
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
  const startDate = resolveEncodedDay(y, m, day);
  const endDate = resolveEncodedDay(y, m + 1, day);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return { startDate: toIsoDate(startDate), endDate: toIsoDate(endDate) };
}

module.exports = { clampBudgetStartDay, budgetMonthToDateRange, MIN_BUDGET_START_DAY, MAX_BUDGET_START_DAY };
