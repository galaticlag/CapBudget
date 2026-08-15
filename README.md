# CapBudget

Self-hosted household budgeting app (built for Raspberry Pi / DietPi). It imports bank
CSV exports, auto-categorizes transactions with user-defined rules, and visualizes
income/expenses per household as a Sankey flow (revenue on the left, expenses on the
right) with month-range filters and category drill-down.

## What it does

- **Multi-household, multi-user**: a global ADMIN manages users and households; MEMBER
  users are attached to one or more households and manage that household's finances.
- **One SQLite database per household** (`data/households/<key>.sqlite`), plus one
  `data/core.sqlite` for users/households/sessions/global catalog. No shared financial
  data between households, ever.
- **CSV import wizard**: upload any bank export, map its columns (any order/names) to
  normalized fields, preview parsed rows (with strict date parsing — ambiguous/invalid
  dates are row errors, never silently guessed), see duplicate/potential-duplicate
  detection, then commit.
- **Categorization rules**: auto-assign category/subcategory/cashflow/nature to new (or
  historical) transactions based on `CONTAINS` / `EQUALS` / `REGEX` matches. Each rule can
  compare its value against any combination of the raw label, suggested label and/or
  comment at once (matches if ANY of the checked fields matches) — handy for bulk
  categorization.
- **Budget types**: each household gets 3 default budget types — `Besoins essentiels`
  (50%), `Envies / Loisirs` (30%), `Épargne` (20%) — that top-level categories can be
  linked to. The dashboard compares actual spend split vs. these targets.
- **Dashboard**: Sankey diagram + revenue/expense/remaining totals, filterable by month
  range, cashflow, category. `TRANSFER` transactions are visible in the transaction list
  but excluded from the Sankey and totals.
- **Audit log**: every create/update/archive action is logged, per household and
  globally (for ADMIN-level actions).
- **Backup & restore**: any MEMBER can download their household's full SQLite database
  from **Paramètres**, and restore it later (e.g. after migrating the server to a
  Raspberry Pi). See [Backup & restore](#backup--restore) below.
- **Themes**: system / light / dark / high-contrast, saved per user.

## Roles

| Role | Can access financial data? | Manages |
|---|---|---|
| `ADMIN` | No (blocked server-side, 403) | Users, households, user↔household associations, global audit |
| `MEMBER` | Only households they're associated with | Accounts, cashflows, categories, subcategories, rules, transactions, imports, household audit |

All MEMBERs of the same household have identical rights on that household's data.
Household membership is always verified server-side against `household_memberships` —
the client never supplies a raw database path, only a household ID that gets checked.

## Categorization rule reference

| Field | Values |
|---|---|
| `match_raw_label`, `match_suggested_label`, `match_comment` | Booleans — at least one must be `true`. The rule matches a transaction as soon as ONE of the checked fields matches (OR, not AND). |
| `match_type` | `CONTAINS` (case-insensitive substring), `EQUALS` (case-insensitive exact), `REGEX` (case-insensitive, guarded against catastrophic-backtracking patterns) |

Rules can set `category_id`, `subcategory_id`, `cashflow_id` and/or `nature`. The first
matching active rule wins (rules are evaluated oldest-first). Rules can be re-applied to
historical transactions, but never overwrite a transaction that was manually edited
(`is_manually_edited = 1`) unless you explicitly opt in to overwrite manual changes.

## Requirements

- Node.js **22.5+** (uses the native `node:sqlite` module — no external DB driver, no
  build step).
- Or Docker, if you don't want to install Node locally.

## Install & run (local)

```bash
npm install
npm start          # production start: node server.js
# or, for auto-restart on file changes during dev:
npm run dev
```

The server listens on `http://localhost:3000` by default. Configurable via environment
variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `APP_DATA_DIR` | `<project>/data` | Where `core.sqlite` and `households/*.sqlite` are stored |

Data is stored entirely under `APP_DATA_DIR`, separate from the application code — you
can back up/restore the whole app by copying that directory (server stopped), or restore
a single household's data live from the UI — see [Backup & restore](#backup--restore).

## Install & run (Docker)

```bash
docker compose up --build -d
```

This builds the image, mounts a named volume (`capbudget_data`) at `/app-data`, and
exposes the app on port `3000`. Data persists across container rebuilds via the volume.

## First run

There is **no default/preset admin login or password** — you choose them yourself the
first time the app starts.

1. Open `http://localhost:3000`. Since no user exists yet, you'll land on **"Créez le
   compte administrateur pour démarrer"** — this is a one-time setup screen (it
   disappears permanently once the first user is created, and this exact form can never
   be reached again).
2. Create the initial **ADMIN** account by choosing your own login and password (8+
   characters). Whatever you type here becomes the permanent admin credential — write it
   down somewhere safe, there is no "default" to fall back to.
3. Log in as that ADMIN. You'll see the **admin console**, not a financial dashboard —
   ADMIN accounts are intentionally locked out of all household financial data.
4. In the admin console:
   - **Create a household** (e.g. "Foyer Dupont"). This seeds it with a default active
     cashflow, the default category/subcategory catalog, and the 3 default budget types
     (50/30/20).
   - **Create a MEMBER user** and assign it to that household — the "Foyer" dropdown in
     the user-creation form always lets you either pick an existing household or choose
     **"+ Créer un nouveau foyer"** to create one inline, so you never need to create the
     household separately beforehand.
5. Log out, log back in as the new MEMBER user. You now land on the household dashboard.

### Changing your password (ADMIN or MEMBER)

Any logged-in user (ADMIN included) can change their own password from
**Paramètres → Changer le mot de passe**, by entering their current password and a new
one (8+ characters). This also revokes all of that user's other active sessions. There
is currently no self-service "forgot password" recovery — if an ADMIN password is lost,
it must be reset directly in `core.sqlite` (or by an operator with server/file access),
since there is no secondary admin account by default.
6. From there, as MEMBER:
   - Go to **Import CSV** to bring in your first bank export (map columns → preview →
     commit).
   - Go to **Référentiel** to review/adjust categories, subcategories, budget types, and
     cashflows.
   - Go to **Règles** to set up auto-categorization rules for recurring labels.
   - Check **À vérifier** for uncategorized transactions, missing-cashflow transactions,
     potential duplicates, or import errors that need a decision.
   - Use **Tableau de bord** for the Sankey view and budget-type target-vs-actual
     breakdown.

## Backup & restore

Each household can export/import its own SQLite file straight from the app, without
server/file access — useful for testing, or migrating the whole deployment to another
machine (e.g. a Raspberry Pi):

- **Paramètres → Télécharger une sauvegarde**: checkpoints the household's WAL, then
  downloads its live `.sqlite` file as-is (`GET /api/household/backup`).
- **Paramètres → Restaurer depuis une sauvegarde**: pick a previously downloaded
  `.sqlite` file and upload it (`POST /api/household/restore`, up to 64 MB). The server:
  1. rejects anything that isn't a real SQLite file (magic header check);
  2. copies the *current* household file to `data/backups/` first, as a safety net;
  3. closes the cached connection, overwrites the file (and clears stale `-wal`/`-shm`
     sidecars), then reopens it — re-running schema migrations automatically.

This **replaces all of that household's data**, and only that household's — other
households sharing the same server/core database are untouched. There's no confirmation
undo beyond the automatic safety copy in `data/backups/`, so double-check the file you're
uploading.

To migrate the entire app to a new machine (all households, users, sessions), stop the
server and copy the whole `APP_DATA_DIR` directory instead — the in-app backup only
covers one household's database.

## Testing

```bash
npm test
```

Runs the full `node:test` suite (unit tests for CSV parsing/date handling/rule matching,
plus a full HTTP integration suite using Fastify's `inject()` against an isolated
temp data directory — no real server/port needed).

## Project structure

```text
server.js              Fastify app bootstrap (buildApp/start), route registration
src/
  auth/                 Password hashing, session middleware, RBAC checks
  db/                   core.sqlite + per-household sqlite schema/connections
  routes/               REST endpoints (auth, setup, admin, households, referentials,
                         transactions, imports, dashboard, audit, household backup/restore)
  services/             Business logic (import parsing/dedup, rules, dashboard
                         aggregation, seeding, audit logging)
  util/                 ID generation helpers
public/
  index.html, styles.css
  js/
    main.js             Hash-router + app shell + auth flow
    views/               One render function per screen (dashboard, transactions,
                         import, rules, referentials, audit, settings, admin, auth)
    vendor/              Vendored D3 + d3-sankey (no CDN dependency)
test/                    node:test unit + integration tests
data/                    Runtime SQLite files (created on first run, gitignored)
```
