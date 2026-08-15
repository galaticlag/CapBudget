'use strict';

const crypto = require('node:crypto');

function normalizeHeader(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function detectDelimiter(headerLine) {
  const candidates = [';', ',', '\t'];
  let best = ';';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = headerLine.split(candidate).length;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

// Minimal RFC4180-ish line splitter: handles quoted fields with embedded delimiters.
function splitCsvLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function isValidCalendarDate(year, month, day) {
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

// Spec: only these explicit formats are accepted; anything ambiguous/invalid is a row error.
function parseDateStrict(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    const [, y, m, d] = match.map(Number);
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (match) {
    const [, dStr, mStr, yStr] = match;
    const d = Number(dStr);
    const m = Number(mStr);
    const y = Number(yStr);
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${yStr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw);
  if (match) {
    const [, dStr, mStr, yStr] = match;
    const d = Number(dStr);
    const m = Number(mStr);
    const y = Number(yStr);
    if (!isValidCalendarDate(y, m, d)) return null;
    return `${yStr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  return null;
}

function parseAmount(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // Handle both "1 234,56" (EU) and "1234.56" (US) input styles.
  let normalized = raw.replace(/\s/g, '');
  if (/,/.test(normalized) && /\d,\d{1,2}$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function normalizeLabel(label) {
  return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function computeFingerprint({ accountId, operationDate, valueDate, amountCents, currencyCode, rawLabel }) {
  const payload = [
    accountId || '',
    operationDate || '',
    valueDate || '',
    String(amountCents),
    currencyCode || 'EUR',
    normalizeLabel(rawLabel)
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

module.exports = {
  normalizeHeader,
  detectDelimiter,
  splitCsvLine,
  parseDateStrict,
  parseAmount,
  normalizeLabel,
  computeFingerprint
};
