# Claude Project Context: SubTracker

This file gives Claude a fast, accurate map of the codebase so changes can be made safely.

## Project Summary

SubTracker is a full-stack personal finance dashboard.

It tracks:
- Subscriptions
- EMIs
- Credit cards
- Bank accounts
- Receivables
- CapEx items
- Rent

It also computes smart card-payment allocation and shows summary dashboard cards.

## Stack

- Frontend (web): React 18 + TypeScript + Vite + TailwindCSS
- Mobile: React Native (Expo 52) + Expo Router + TypeScript
- Backend: Flask + Flask-CORS + Flask-JWT-Extended
- DB: PostgreSQL (Supabase-compatible schema)

## Repository Layout

```
backend/
  app.py              Flask app factory and blueprint registration
  db.py               psycopg2 helpers (fetchall, fetchone, execute)
  utils.py            Response helpers (ok, err) and date utilities
  routes/             Thin REST handlers by entity (subscriptions, emis, cards…)
  services/           Domain logic (allocation, snapshots, daily_logs)
  modules/            Self-contained plug-and-play modules (see Module Architecture)
  seed.sql            Schema + seed data
  seed.py             Runs seed.sql
  migrations/         Incremental SQL patches

frontend/
  src/
    components/       Dashboard and UI cards
    hooks/            Data-fetching hooks per entity
    services/api.ts   Shared API client (attaches JWT header)
    types/index.ts    Frontend type contracts
    modules/          Self-contained plug-and-play modules (see Module Architecture)
    store/            Layout persistence (Zustand)
    lib/utils.ts      Formatting helpers (formatINR, cn, …)

mobile/
  app/                Expo Router file-based routes
    (auth)/           Login + register screens
    (tabs)/           Main tab screens (dashboard, cards, budget, profile)
    _layout.tsx       Root layout with auth gate
  components/         Shared RN components (SummaryCard, ItemCard, …)
  constants/          theme.ts (colors/spacing) + api.ts (BASE_URL)
  hooks/              useAuth.tsx (SecureStore-backed auth context)
  services/api.ts     Async fetch client (SecureStore token)
  types/index.ts      Shared TypeScript contracts (mirrors backend schema)
  app.json            Expo config (android.package, scheme, etc.)
  eas.json            EAS Build profiles for Play Store
```

## Module Architecture

**Rule: any cross-cutting concern that could be reused in another project lives in a module.**

### What belongs in a module

A module owns everything for one vertical slice of functionality:
- Its own DB table(s) (declared in `migration.sql`)
- Business logic with no HTTP or framework imports (`service.py` / `service.ts`)
- HTTP handlers that are thin wrappers over the service (`routes.py`)
- Frontend state, API client, and UI (`AuthContext.tsx`, `api.ts`, `LoginPage.tsx`)
- A barrel export that is the only public surface (`__init__.py` / `index.ts`)

### Module conventions

#### Backend module (`backend/modules/<name>/`)

```
__init__.py      Exports `bp` — the only symbol the host app needs
migration.sql    Creates tables owned by this module (idempotent, IF NOT EXISTS)
service.py       Pure business logic — no Flask, raises ModuleError on failures
routes.py        Flask Blueprint — calls service, translates errors to HTTP
[helpers].py     Optional supporting files (email.py, validators.py, …)
```

- `service.py` must not import Flask or flask_jwt_extended.
- `service.py` may import `db.py` and `utils.py` from the host project.
- `routes.py` is the only file that imports Flask or JWT utilities.
- Errors are communicated via a typed exception (e.g. `AuthError(message, status)`).

Integrate in `app.py`:
```python
from modules.auth import bp as auth_bp
app.register_blueprint(auth_bp)
```

#### Frontend module (`frontend/src/modules/<name>/`)

```
index.ts         Barrel — the only import point for consumers
types.ts         TypeScript interfaces owned by this module
api.ts           Self-contained fetch client (plain fetch, NOT the shared request())
[Context].tsx    React context + provider if the module is stateful
[Page].tsx       UI entry point(s)
```

- `api.ts` uses plain `fetch` directly — it does NOT import from `services/api.ts`.
  (Auth calls establish sessions; they must not carry a JWT header themselves.)
- Cross-module imports are forbidden. Modules only import from their own files,
  `@/lib/utils`, and third-party packages.

Integrate in `main.tsx` / `App.tsx`:
```tsx
import { AuthProvider, useAuth, LoginPage } from "@/modules/auth";
```

### Existing modules

| Module | Backend | Frontend | Owns |
|--------|---------|----------|------|
| `auth` | `backend/modules/auth/` | `frontend/src/modules/auth/` | `users` table, JWT sessions, Google SSO + email/password |
| `gmail` | `backend/modules/gmail/` | `frontend/src/modules/gmail/` | Gmail OAuth tokens, `gmail_sync_log` table, email sync |
| `expense_tracker` | `backend/modules/expense_tracker/` | `frontend/src/modules/expense_tracker/` | `trackers`, `tracker_members`, `tracker_expenses`, `tracker_expense_splits`, `tracker_expense_payments`, `tracker_categories` tables; group expense splitter (formerly "Trips"); designed to be liftable to its own microservice without code changes |

### Adding a new module

1. Create `backend/modules/<name>/` with the files above.
2. Create `frontend/src/modules/<name>/` with the files above.
3. Write `migration.sql` — one `CREATE TABLE IF NOT EXISTS` per owned table.
4. Register the blueprint in `app.py` (one line).
5. Import from the module's `index.ts` in the frontend entry point.
6. Update this file's module table above.

## Local Development

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python seed.py
python app.py
```

Backend runs on http://localhost:5000.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on http://localhost:5173.
Vite proxies /api to http://localhost:5000.

### Mobile

```bash
cd mobile
npm install
npx expo start          # scan QR with Expo Go app
npx expo start --android  # Android emulator
```

Set `API_BASE` in `mobile/constants/api.ts` to your backend's LAN IP or ngrok URL.

#### Play Store build

```bash
npm install -g eas-cli
eas login
eas build --platform android --profile production
```

Submit the generated `.aab` to Google Play Console.

## Environment

`backend/.env`:

```env
DATABASE_URL=postgresql://username:password@host:5432/dbname
JWT_SECRET_KEY=long-random-secret

# Auth module — email confirmation
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=you@gmail.com
BACKEND_URL=http://localhost:5000
FRONTEND_URL=http://localhost:5173

# Auth module — Google SSO (optional)
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com

# Gmail module
GOOGLE_CLIENT_SECRET=xxxx
GMAIL_SYNC_LOOKBACK_DAYS=30
```

`frontend/.env`:

```env
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
```

## API Contract

All backend responses are shaped as:

```json
{ "data": <payload-or-null>, "error": <string-or-null> }
```

Main route prefixes:
- /api/auth          (auth module)
- /api/gmail         (gmail module — status, connect, callback, sync, disconnect)
- /api/subscriptions
- /api/emis
- /api/cards
- /api/accounts
- /api/receivables
- /api/capex
- /api/rent
- /api/smart-allocation
- /api/snapshots
- /api/daily-logs

All routes except `/api/auth/*` and `/api/gmail/callback` require a `Authorization: Bearer <token>` header.

## Important Implementation Details

- Credit cards include a computed field `due_date_offset` (days until due date) in backend responses.
- Smart allocation logic is in `backend/services/allocation.py`.
- Snapshot recording is in `backend/services/snapshots.py`, called from update routes.
- Daily logs (full snapshots for history/compare) are in `backend/services/daily_logs.py`.
- Frontend API wrappers are in `frontend/src/services/api.ts` — attaches JWT automatically.
  Auth-specific calls live in `frontend/src/modules/auth/api.ts` (no JWT attached).

## Data and Schema Notes

- Primary schema and seed records are in `backend/seed.sql`.
- Each module owns its schema in `backend/modules/<name>/migration.sql`.
- All other migrations are SQL files under `backend/migrations/`.
- Apply migrations in order; filenames are prefixed with a description.

## Editing Guidelines

- **Modular first**: any feature that could be reused goes into a module.
- **Thin routes**: route handlers call service functions; they do not contain business logic.
- **Service purity**: service files have no HTTP or framework imports.
- **No cross-module imports**: modules do not import from each other.
- **Scoped changes**: keep diffs minimal; touch only files relevant to the change.
- **Type contracts**: do not break `frontend/src/types/index.ts` without updating all dependents.
- **DB changes**: add a `migration.sql` file; never silently change schema assumptions in code.
- **Re-exports for backwards-compat**: when moving a file into a module, leave a one-line
  re-export at the old path so existing imports don't break.

## Quick Verification Checklist

- Backend starts without import/runtime errors.
- Frontend dev server starts and API calls succeed through Vite proxy.
- CRUD still works for modified entities.
- Smart allocation endpoint returns valid summary and allocations.
- Auth: register → confirm email → login → JWT accepted on protected routes.
- If schema changed, `migration.sql` is present and documented.
- Gmail: `GET /api/gmail/status` returns `{connected, connected_at, last_synced_at}`.
- Mobile: `npx expo start` launches without errors; login flow works against backend.

## Mobile Notes

- Mobile app lives in `mobile/` — standalone Expo project, no code shared with `frontend/`.
- API base URL is set in `mobile/constants/api.ts`. Update this for each environment.
- JWT token is stored in `expo-secure-store` (encrypted on-device).
- Gmail Connect flow must be done from the **web app** (OAuth redirects to a web URL). The mobile app shows sync status and a "Sync Now" button if already connected.
- For Play Store: run `eas build --platform android --profile production`. Requires an Expo account and `eas.json` already configured.
