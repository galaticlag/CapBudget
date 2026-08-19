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
  const day = Number(budgetStartDay) || 1;
  const now = new Date();
  now.setDate(1);
  if (new Date().getDate() < day) now.setMonth(now.getMonth() - 1);
  now.setMonth(now.getMonth() + offsetMonths);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Real [startDate, endDate] (YYYY-MM-DD) calendar dates covered by budget-month
// label `monthStr`, mirrors src/util/budgetMonth.js on the server.
function budgetMonthToDateRange(monthStr, budgetStartDay = 1) {
  const [y, m] = String(monthStr || '').split('-').map((v) => Number(v));
  const day = Math.min(28, Math.max(1, Number(budgetStartDay) || 1));
  const start = new Date(Date.UTC(y, m - 1, day));
  const end = new Date(Date.UTC(y, m, day));
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

export { escapeHtml, formatCents, formatDate, currentMonthStr, currentBudgetMonthStr, budgetMonthToDateRange, el };
