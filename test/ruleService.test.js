'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { matches, isSafeRegex, findMatchingRule } = require('../src/services/ruleService');

test('isSafeRegex accepts simple patterns', () => {
  assert.equal(isSafeRegex('loyer'), true);
  assert.equal(isSafeRegex('^EDF|ENGIE$'), true);
});

test('isSafeRegex rejects overly long patterns', () => {
  assert.equal(isSafeRegex('a'.repeat(201)), false);
});

test('isSafeRegex rejects invalid regex syntax', () => {
  assert.equal(isSafeRegex('('), false);
});

test('isSafeRegex rejects nested-quantifier ReDoS-prone patterns', () => {
  assert.equal(isSafeRegex('(a+)+'), false);
  assert.equal(isSafeRegex('(a*)*'), false);
});

test('matches CONTAINS is case-insensitive substring match', () => {
  const rule = { match_raw_label: true, match_type: 'CONTAINS', match_value: 'edf' };
  assert.equal(matches(rule, 'Prelevement EDF Electricite', null), true);
  assert.equal(matches(rule, 'Autre chose', null), false);
});

test('matches EQUALS requires an exact case-insensitive match', () => {
  const rule = { match_raw_label: true, match_type: 'EQUALS', match_value: 'Loyer' };
  assert.equal(matches(rule, 'loyer', null), true);
  assert.equal(matches(rule, 'Loyer appartement', null), false);
});

test('matches REGEX applies the pattern case-insensitively', () => {
  const rule = { match_raw_label: true, match_type: 'REGEX', match_value: '^(EDF|ENGIE)' };
  assert.equal(matches(rule, 'edf electricite', null), true);
  assert.equal(matches(rule, 'engie gaz', null), true);
  assert.equal(matches(rule, 'autre', null), false);
});

test('matches REGEX refuses to evaluate an unsafe pattern', () => {
  const rule = { match_raw_label: true, match_type: 'REGEX', match_value: '(a+)+' };
  assert.equal(matches(rule, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!', null), false);
});

test('matches SUGGESTED_LABEL field falls back to empty string when absent', () => {
  const rule = { match_suggested_label: true, match_type: 'CONTAINS', match_value: 'abo' };
  assert.equal(matches(rule, 'raw label', null), false);
  assert.equal(matches(rule, 'raw label', 'Abonnement'), true);
});

test('matches COMMENT field is checked independently from raw/suggested label', () => {
  const rule = { match_comment: true, match_type: 'CONTAINS', match_value: 'remboursement partiel' };
  assert.equal(matches(rule, 'raw label', 'suggested', null), false);
  assert.equal(matches(rule, 'raw label', 'suggested', 'Remboursement partiel ami'), true);
});

test('matches with several fields enabled matches as soon as ONE of them matches', () => {
  const rule = { match_raw_label: true, match_comment: true, match_type: 'CONTAINS', match_value: 'edf' };
  assert.equal(matches(rule, 'Prelevement quelconque', null, 'Facture EDF'), true);
  assert.equal(matches(rule, 'Prelevement EDF', null, 'Autre commentaire'), true);
  assert.equal(matches(rule, 'Prelevement quelconque', null, 'Autre commentaire'), false);
});

test('findMatchingRule returns the first active rule matching, ordered by creation', () => {
  const rules = [
    { id: 'r1', created_at: '2026-01-01', is_active: 1, match_raw_label: true, match_type: 'CONTAINS', match_value: 'super' },
    { id: 'r2', created_at: '2026-01-02', is_active: 1, match_raw_label: true, match_type: 'CONTAINS', match_value: 'supermarche' }
  ];
  const fakeDb = {
    prepare() {
      return {
        all() { return rules; }
      };
    }
  };
  const rule = findMatchingRule(fakeDb, 'Supermarche Leclerc', null);
  assert.equal(rule.id, 'r1');
});

test('findMatchingRule returns null when nothing matches', () => {
  const fakeDb = { prepare: () => ({ all: () => [] }) };
  assert.equal(findMatchingRule(fakeDb, 'Anything', null), null);
});
