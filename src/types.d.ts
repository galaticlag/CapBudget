// Central domain type definitions for Lyrava, mirroring the SQLite schema in
// src/db/household.js (ensureHouseholdSchema). Ambient .d.ts file: no build step,
// no runtime effect — used only by `tsc --checkJs` (see `npm run typecheck`) and by
// editor/AI tooling for accurate autocomplete on service/route boundaries.
//
// Keep field names snake_case to match raw SQLite rows returned by `db.prepare(...).all()`.
// Routes are responsible for mapping to camelCase JSON when needed.

export interface Account {
  id: string;
  household_id: string;
  bank_account_reference_masked: string;
  bank_account_label: string;
  is_archived: 0 | 1;
  created_at: string;
  archived_at: string | null;
}

export interface Cashflow {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  color: string | null;
  is_default: 0 | 1;
  is_archived: 0 | 1;
  created_at: string;
  archived_at: string | null;
}

export interface BudgetType {
  id: string;
  household_id: string;
  name: string;
  color: string;
  percentage: number;
  is_default: 0 | 1;
  is_active: 0 | 1;
  display_order: number;
  created_at: string;
}

export interface Category {
  id: string;
  household_id: string;
  name: string;
  kind: 'REVENUE' | 'EXPENSE';
  color: string | null;
  icon: string | null;
  display_order: number;
  is_system: 0 | 1;
  is_active: 0 | 1;
  budget_type_id: string | null;
  exclude_from_dashboard: 0 | 1;
}

export interface Subcategory {
  id: string;
  household_id: string;
  category_id: string;
  name: string;
  color: string | null;
  icon: string | null;
  display_order: number;
  is_system: 0 | 1;
  is_active: 0 | 1;
  budget_type_id: string | null;
}

export type TransactionNature = 'REVENUE' | 'EXPENSE' | 'TRANSFER';
export type TransactionStatus = 'ACTIVE' | 'ARCHIVED';
export type TransactionSource = 'IMPORT' | 'MANUAL';

export interface Transaction {
  id: string;
  household_id: string;
  account_id: string | null;
  import_batch_id: string | null;
  operation_date: string;
  value_date: string | null;
  raw_label: string;
  suggested_label: string | null;
  amount_cents: number;
  currency_code: string;
  balance_after_cents: number | null;
  comment: string | null;
  category_id: string;
  subcategory_id: string | null;
  cashflow_id: string | null;
  nature: TransactionNature;
  status: TransactionStatus;
  source: TransactionSource;
  source_fingerprint: string | null;
  is_manually_edited: 0 | 1;
  excluded_from_cashflow: 0 | 1;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
}

export type RuleMatchType = 'CONTAINS' | 'EQUALS' | 'REGEX';

// The subset of CategorizationRule fields actually needed to test a match — matches()
// in ruleService.js only reads these, and route handlers (e.g. POST /api/rules/preview)
// build ad hoc objects with just this shape before a rule is even saved.
export interface RuleMatchCriteria {
  match_raw_label: 0 | 1 | boolean;
  match_suggested_label: 0 | 1 | boolean;
  match_comment: 0 | 1 | boolean;
  match_type: RuleMatchType;
  match_value: string;
}

export interface CategorizationRule extends RuleMatchCriteria {
  id: string;
  household_id: string;
  name: string;
  // Legacy column, kept only to satisfy a stale CHECK constraint — never read for logic.
  // See claude.md "Migration convention" for why this isn't cleaned up via a table rebuild.
  match_field: 'RAW_LABEL' | 'SUGGESTED_LABEL';
  category_id: string | null;
  subcategory_id: string | null;
  cashflow_id: string | null;
  nature: TransactionNature | null;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
}

export interface HouseholdObjective {
  id: string;
  household_id: string;
  name: string;
  description: string | null;
  target_month: string;
  budget_type_id: string;
  percentage: number;
  is_active: 0 | 1;
  created_at: string;
}

export interface HouseholdAuditLog {
  id: string;
  household_id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

// ---- core.sqlite (cross-household) ----

export type MembershipRole = 'ADMIN' | 'MEMBER';
export type ThemePreference = 'SYSTEM' | 'LIGHT' | 'DARK' | 'HIGH_CONTRAST';
export type SankeyDetailLevel = 'SUMMARY' | 'BALANCED' | 'DETAILED';

export interface Household {
  id: string;
  name: string;
  currency_code: string;
  database_key: string;
  is_active: 0 | 1;
  created_at: string;
}

export interface User {
  id: string;
  login: string;
  password_hash: string;
  role: MembershipRole;
  theme_preference: ThemePreference;
  sankey_detail_level: SankeyDetailLevel;
  is_active: 0 | 1;
  created_at: string;
  last_login_at: string | null;
}

export interface HouseholdMembership {
  household_id: string;
  user_id: string;
  created_at: string;
  created_by_admin_id: string | null;
}

export interface Session {
  id: string;
  user_id: string;
  created_at: string;
  last_seen: string;
}

// Admin-managed template catalog, copied per-household on creation by seedService.js.
// A row with parent_id === null is a category; a row with parent_id set is a subcategory.
export interface GlobalCatalogEntry {
  id: string;
  parent_id: string | null;
  name: string;
  kind: 'REVENUE' | 'EXPENSE' | null;
  color: string | null;
  icon: string | null;
  display_order: number;
  budget_type_key: string | null;
}

export interface GlobalAuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}
