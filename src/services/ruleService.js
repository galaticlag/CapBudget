'use strict';

// Basic static guard against catastrophic-backtracking regex patterns (ReDoS):
// rejects obvious nested-quantifier constructs (e.g. "(a+)+", "(a*){2,}") and
// caps pattern length. Plain grouping/alternation like "(EDF|ENGIE)" is safe
// and must not be rejected — only a quantifier *inside* the group followed by
// another quantifier *outside* it is flagged.
const RISKY_REGEX_PATTERN = /\([^()]*[+*][^()]*\)[+*{]/;
const MAX_PATTERN_LENGTH = 200;

function isSafeRegex(pattern) {
  if (String(pattern).length > MAX_PATTERN_LENGTH) return false;
  if (RISKY_REGEX_PATTERN.test(pattern)) return false;
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, 'i');
    return true;
  } catch (err) {
    return false;
  }
}

function testField(matchType, value, text) {
  const haystack = text || '';
  if (matchType === 'CONTAINS') {
    return haystack.toLowerCase().includes(value.toLowerCase());
  }
  if (matchType === 'EQUALS') {
    return haystack.toLowerCase() === value.toLowerCase();
  }
  if (matchType === 'REGEX') {
    if (!isSafeRegex(value)) return false;
    try {
      return new RegExp(value, 'i').test(haystack);
    } catch (err) {
      return false;
    }
  }
  return false;
}

// A rule can be configured to match against any combination of raw label / suggested
// label / comment at once (checkboxes in the UI) — it matches a transaction as soon as
// ONE of its enabled fields matches, which is what makes bulk categorization practical.
function matches(rule, rawLabel, suggestedLabel, comment) {
  const value = String(rule.match_value);
  if (rule.match_raw_label && testField(rule.match_type, value, rawLabel)) return true;
  if (rule.match_suggested_label && testField(rule.match_type, value, suggestedLabel)) return true;
  if (rule.match_comment && testField(rule.match_type, value, comment)) return true;
  return false;
}

// First-match-wins across active rules, ordered by creation (oldest = highest priority).
function findMatchingRule(db, rawLabel, suggestedLabel, comment) {
  const rules = db.prepare('SELECT * FROM categorization_rules WHERE is_active = 1 ORDER BY created_at ASC').all();
  for (const rule of rules) {
    if (matches(rule, rawLabel, suggestedLabel, comment)) return rule;
  }
  return null;
}

module.exports = { findMatchingRule, matches, isSafeRegex };
