'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildColumnMapping,
  mappingToHeaderNames,
  parseCsvStructure,
  splitLines
} = require('../src/services/importService');

test('splitLines drops blank lines', () => {
  assert.deepEqual(splitLines('a\n\nb\r\nc\r\n\n'), ['a', 'b', 'c']);
});

test('parseCsvStructure auto-detects delimiter and headers', () => {
  const { delimiter, headers, dataLines } = parseCsvStructure('date;libelle;montant\n2026-01-01;Loyer;-800.00');
  assert.equal(delimiter, ';');
  assert.deepEqual(headers, ['date', 'libelle', 'montant']);
  assert.deepEqual(dataLines, ['2026-01-01;Loyer;-800.00']);
});

test('buildColumnMapping auto-detects fields via known aliases', () => {
  const headers = ['date', 'libelle', 'montant', 'compte'];
  const mapping = buildColumnMapping(headers);
  assert.equal(mapping.operation_date, 0);
  assert.equal(mapping.label, 1);
  assert.equal(mapping.amount, 2);
  assert.equal(mapping.account_reference, 3);
  assert.equal(mapping.value_date, -1);
});

test('buildColumnMapping respects an explicit header-name mapping override', () => {
  const headers = ['Date Operation', 'Description', 'Valeur', 'IBAN'];
  const explicitMapping = {
    operation_date: 'Date Operation',
    label: 'Description',
    amount: 'Valeur',
    account_reference: 'IBAN'
  };
  const mapping = buildColumnMapping(headers, explicitMapping);
  assert.equal(mapping.operation_date, 0);
  assert.equal(mapping.label, 1);
  assert.equal(mapping.amount, 2);
  assert.equal(mapping.account_reference, 3);
});

test('mappingToHeaderNames + buildColumnMapping round-trip without index/name confusion', () => {
  const headers = ['Date Operation', 'Description', 'Valeur', 'IBAN'];
  const firstPass = buildColumnMapping(headers);
  const named = mappingToHeaderNames(firstPass, headers);
  // Resending the header-name mapping as explicitMapping must reproduce the same indices.
  const secondPass = buildColumnMapping(headers, named);
  assert.deepEqual(firstPass, secondPass);
});

test('mappingToHeaderNames maps unmapped fields (-1) to null', () => {
  const headers = ['date', 'libelle', 'montant'];
  const mapping = buildColumnMapping(headers);
  const named = mappingToHeaderNames(mapping, headers);
  assert.equal(named.value_date, null);
  assert.equal(named.operation_date, 'date');
});
