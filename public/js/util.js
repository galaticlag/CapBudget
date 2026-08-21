'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatCents(cents, currency = 'EUR') {
  const value = (Number(cents) || 0) / 100;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
}

function formatDate(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).slice(0, 10).split('-');
  if (!y) return isoDate;
  return `${d}/${m}/${y}`;
}

function currentMonthStr(offsetMonths = 0) {
  const now = new Date();
  now.setDate(1);
  now.setMonth(now.getMonth() + offsetMonths);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// "Budget month" label ("YYYY-MM") for the household's current period, given its
// configured start day (1 = plain calendar month, identical to currentMonthStr).
// If today falls before the start day, the current budget month is still the
// PREVIOUS calendar month (e.g. start day 25, today the 10th -> last month).
function currentBudgetMonthStr(budgetStartDay = 1, offsetMonths = 0) {
  const day = clampBudgetStartDay(budgetStartDay);
  const today = new Date();
  const now = new Date(today.getFullYear(), today.getMonth(), 1);
  const resolvedDayThisMonth = resolveBudgetDayOfMonth(now.getFullYear(), now.getMonth(), day);
  if (today.getDate() < resolvedDayThisMonth) now.setMonth(now.getMonth() - 1);
  now.setMonth(now.getMonth() + offsetMonths);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// budgetStartDay is a signed "day encoding" (mirrors src/util/budgetMonth.js):
// positive (1..28) = the Nth day of the month; negative (-1..-15) = counts
// backward from that month's LAST day (-1 = last day, -2 = second-to-last...).
function clampBudgetStartDay(day) {
  const n = Number(day);
  if (!Number.isInteger(n) || n === 0) return 1;
  return Math.min(28, Math.max(-15, n));
}

// Resolves a signed day encoding to the actual day-of-month number, within the
// given 0-indexed JS `month` (year/month may roll over via JS Date semantics).
function resolveBudgetDayOfMonth(year, month, dayEncoding) {
  if (dayEncoding > 0) return dayEncoding;
  return new Date(year, month + 1, dayEncoding + 1).getDate();
}

// Resolves a signed day encoding to an actual date within 1-indexed calendar
// `month` (mirrors resolveEncodedDay in src/util/budgetMonth.js).
function resolveEncodedBudgetDay(y, month, dayEncoding) {
  if (dayEncoding > 0) return new Date(Date.UTC(y, month - 1, dayEncoding));
  return new Date(Date.UTC(y, month, dayEncoding + 1));
}

// Real [startDate, endDate] (YYYY-MM-DD) calendar dates covered by budget-month
// label `monthStr`, mirrors src/util/budgetMonth.js on the server.
function budgetMonthToDateRange(monthStr, budgetStartDay = 1) {
  const [y, m] = String(monthStr || '').split('-').map((v) => Number(v));
  const day = clampBudgetStartDay(budgetStartDay);
  const start = resolveEncodedBudgetDay(y, m, day);
  const end = resolveEncodedBudgetDay(y, m + 1, day);
  end.setUTCDate(end.getUTCDate() - 1);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === undefined || child === null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export { escapeHtml, formatCents, formatDate, currentMonthStr, currentBudgetMonthStr, budgetMonthToDateRange, clampBudgetStartDay, resolveBudgetDayOfMonth, el };
