'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHeader,
  detectDelimiter,
  splitCsvLine,
  parseDateStrict,
  parseAmount,
  computeFingerprint
} = require('../src/util/csv');

test('normalizeHeader lowercases, strips accents and punctuation', () => {
  assert.equal(normalizeHeader('Libellé'), 'libelle');
  assert.equal(normalizeHeader('Date d\'opération'), 'date_d_operation');
  assert.equal(normalizeHeader('  Montant  '), 'montant');
});

test('detectDelimiter picks the delimiter producing the most columns', () => {
  assert.equal(detectDelimiter('date;libelle;montant'), ';');
  assert.equal(detectDelimiter('date,libelle,montant'), ',');
});

test('splitCsvLine handles quoted fields with embedded delimiters', () => {
  const fields = splitCsvLine('2026-01-01;"Loyer; appartement";-800.00', ';');
  assert.deepEqual(fields, ['2026-01-01', 'Loyer; appartement', '-800.00']);
});

test('splitCsvLine handles escaped double quotes', () => {
  const fields = splitCsvLine('a;"say ""hi""";c', ';');
  assert.deepEqual(fields, ['a', 'say "hi"', 'c']);
});

test('parseDateStrict accepts ISO format', () => {
  assert.equal(parseDateStrict('2026-08-01'), '2026-08-01');
});

test('parseDateStrict accepts DD/MM/YYYY format', () => {
  assert.equal(parseDateStrict('01/08/2026'), '2026-08-01');
});

test('parseDateStrict accepts DD-MM-YYYY format', () => {
  assert.equal(parseDateStrict('01-08-2026'), '2026-08-01');
});

test('parseDateStrict rejects invalid calendar dates', () => {
  assert.equal(parseDateStrict('2026-02-30'), null);
  assert.equal(parseDateStrict('31/04/2026'), null);
});

test('parseDateStrict rejects ambiguous or garbage input', () => {
  assert.equal(parseDateStrict('08/2026'), null);
  assert.equal(parseDateStrict('not a date'), null);
  assert.equal(parseDateStrict(''), null);
  assert.equal(parseDateStrict(null), null);
});

test('parseDateStrict never falls back to Date() heuristics', () => {
  // "2026" alone or US-style month-first slash dates must not silently parse.
  assert.equal(parseDateStrict('2026'), null);
  assert.equal(parseDateStrict('Aug 1 2026'), null);
});

test('parseAmount handles EU decimal comma format', () => {
  assert.equal(parseAmount('1 234,56'), 123456);
  assert.equal(parseAmount('-800,00'), -80000);
});

test('parseAmount handles US decimal point format', () => {
  assert.equal(parseAmount('1234.56'), 123456);
  assert.equal(parseAmount('-800.00'), -80000);
});

test('parseAmount rejects invalid input', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('computeFingerprint is stable for identical inputs', () => {
  const args = {
    accountId: 'acc1',
    operationDate: '2026-08-01',
    valueDate: null,
    amountCents: -80000,
    currencyCode: 'EUR',
    rawLabel: 'Loyer'
  };
  assert.equal(computeFingerprint(args), computeFingerprint({ ...args }));
});

test('computeFingerprint normalizes label whitespace/case', () => {
  const base = {
    accountId: 'acc1',
    operationDate: '2026-08-01',
    valueDate: null,
    amountCents: -80000,
    currencyCode: 'EUR'
  };
  assert.equal(
    computeFingerprint({ ...base, rawLabel: 'Loyer  Appart' }),
    computeFingerprint({ ...base, rawLabel: '  loyer appart  ' })
  );
});

test('computeFingerprint differs when amount or date differs', () => {
  const base = {
    accountId: 'acc1',
    operationDate: '2026-08-01',
    valueDate: null,
    currencyCode: 'EUR',
    rawLabel: 'Loyer'
  };
  assert.notEqual(
    computeFingerprint({ ...base, amountCents: -80000 }),
    computeFingerprint({ ...base, amountCents: -80001 })
  );
  assert.notEqual(
    computeFingerprint({ ...base, amountCents: -80000, operationDate: '2026-08-01' }),
    computeFingerprint({ ...base, amountCents: -80000, operationDate: '2026-08-02' })
  );
});
