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

export { escapeHtml, formatCents, formatDate, currentMonthStr, el };
