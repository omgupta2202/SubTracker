# SubTracker

Two sister apps in one codebase, sharing the same auth + DB:

| App | What it does |
|---|---|
| **SubTracker** (dashboard) | Personal finance — accounts, subscriptions, EMIs, credit cards, receivables, CapEx, rent, smart allocation, Gmail-driven card transaction extraction. |
| **Expense Tracker** | Group expense splitter — trackers (trips, daily expenses, dinner clubs, anything shared), categories, multi-payer expenses, settlement plan, Excel/CSV import, magic-link guest invites, member nudge emails. |

Both run on a single Flask process today. The Expense Tracker is packaged as a clean module ([backend/modules/expense_tracker/](backend/modules/expense_tracker/) + [frontend/src/modules/expense_tracker/](frontend/src/modules/expense_tracker/)) so it can be lifted into its own microservice later without code changes.

## Stack

| Layer | Tech |
|---|---|
| Web | React 18 + TypeScript + Vite + TailwindCSS + recharts + dnd-kit |
| Mobile | React Native + Expo (Android-first) |
| Backend | Flask + Flask-JWT-Extended + Flask-CORS, **Python 3.13** |
| DB | PostgreSQL (Supabase-compatible) |
| Auth | Email + password / Google SSO |
| Email | Resend (preferred) or SMTP — both auto-detected |

## Repo layout

```text
backend/
  app.py               # Flask app factory
  db.py, utils.py      # Shared infra (used by all modules)
  routes/              # Host-app routes (subscriptions, EMIs, cards, dashboard, ...)
  services/            # Host-app business logic
  modules/             # Self-contained modules (auth, gmail, expense_tracker)
    auth/              # Users, JWT, Google SSO + email/password
    gmail/             # Gmail OAuth + sync
    expense_tracker/   # Group splitter — own routes, service, migration, email
  migrations/          # SQL migrations applied incrementally
  Dockerfile, runtime.txt   # python:3.13-slim for Render/Fly
frontend/
  src/
    components/        # Host dashboard UI
    hooks/             # Data hooks per entity
    services/api.ts    # Shared API client (host endpoints only)
    modules/           # Self-contained modules
      auth/
      gmail/
      expense_tracker/ # Tracker UI + own self-contained API client
mobile/                # Expo app (Android-first)
```

## Module convention

A module owns a vertical slice end-to-end:

- Backend: `migration.sql`, `service.py` (no Flask imports), `routes.py`, `__init__.py` exporting `bp`.
- Frontend: own `api.ts` (uses plain `fetch`, **does not** import from `services/api.ts`), own types, components, and a barrel `index.ts`.
- Cross-module imports are forbidden — modules only depend on shared infra (`db`, `utils`, `lib/utils`).

This is how `expense_tracker` is wired today, and is the pattern to follow when adding a new feature you might want to extract later.

Detail in [CLAUDE.md](CLAUDE.md#module-architecture).

## Prerequisites

- **Python 3.13** (production runtime; 3.11+ works locally if you can't upgrade yet)
- **Node.js 24+** (LTS — pinned in `.nvmrc` and `package.json` engines; Netlify builds use 24)
- **PostgreSQL** (a Supabase project works fine)
- **Google OAuth credentials** (for Gmail sync + Google login)
- **Resend API key** OR a Gmail App Password for SMTP (for transactional + invite + reminder emails)

## Environment

Each project ships a tracked `.env.example` you can copy as a starting
point — they document every var (required + optional) with comments:

```bash
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env
cp mobile/.env.example   mobile/.env.local   # Expo reads .env.local
```

### `backend/.env`

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET_KEY=long-random-secret

# Token lifetime for the dashboard session. Default 30 days.
JWT_ACCESS_TOKEN_DAYS=30

BACKEND_URL=http://localhost:5000
FRONTEND_URL=http://localhost:5173

# Google SSO + Gmail sync
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
GMAIL_SYNC_LOOKBACK_DAYS=30

# Email — pick one provider. Resend wins if RESEND_API_KEY is set.
RESEND_API_KEY=re_xxx
SMTP_FROM=hello@yourdomain.com

# OR fall back to SMTP (Gmail app password etc.)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password

# Cron — used by the GitHub Action that warms the host + sends digests.
CRON_SECRET=long-random-secret

SKIP_EMAIL_CONFIRMATION=true
```

### `frontend/.env`

```env
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
# Optional — only needed if you proxy the API through a different host.
VITE_API_BASE=/api
```

## Run locally

### Backend

```bash
cd backend
python3.13 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python seed.py        # first-time setup
python app.py
```

Backend runs on `http://127.0.0.1:5000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`. Vite proxies `/api` to `http://localhost:5000`.

### Mobile

```bash
cd mobile
npm install
npx expo start
```

Set `mobile/constants/api.ts` `API_BASE` to your backend URL (LAN IP or ngrok).

## Database migrations

The host-app migrations live under `backend/migrations/`. Each module owns its own
idempotent migration too — for `expense_tracker`, that's `backend/modules/expense_tracker/migration.sql`.

Apply manually with `psql`, or programmatically:

```bash
cd backend
source venv/bin/activate
python -c "
from dotenv import load_dotenv; load_dotenv()
import os, psycopg2, re, glob
conn = psycopg2.connect(os.environ['DATABASE_URL']); conn.autocommit = True
cur = conn.cursor()
for path in sorted(glob.glob('migrations/*.sql')) + glob.glob('modules/*/migration.sql'):
    sql = re.sub(r'--[^\n]*', '', open(path).read())
    for stmt in [s.strip() for s in sql.split(';') if s.strip()]:
        cur.execute(stmt)
        print('OK', path)
print('done')
"
```

## API notes

Every backend response is shaped `{ "data": <payload>, "error": <string|null> }`. All routes
except `/api/auth/*`, `/api/gmail/callback`, `/api/reminders/action/*`, `/api/unsubscribe/*`,
`/api/reminders/cron`, and `/api/trackers/guest/*` require an `Authorization: Bearer <jwt>` header.

### Route groups

**Host app (SubTracker dashboard)**
- `/api/financial-accounts`, `/api/ledger`, `/api/payments`, `/api/obligations`,
  `/api/billing-cycles`, `/api/smart-allocation`, `/api/dashboard`, `/api/daily-logs`
- `/api/reminders/*` — preferences, manual test, cron trigger
- `/api/unsubscribe/<token>` — public one-click unsubscribe
- Legacy aliases: `/api/subscriptions`, `/api/emis`, `/api/cards`, `/api/accounts`,
  `/api/receivables`, `/api/capex`, `/api/rent`, `/api/snapshots`

**Expense Tracker module**
- Owner: `/api/trackers`, `/api/trackers/templates`, `/api/trackers/<id>{,/expenses,/members,/categories,/settlement,/import,/leave}`
- Guest: `/api/trackers/guest/<token>` (token IS auth — magic-link from invite emails)

**Auth + Gmail modules**
- `/api/auth/*` — register, login, confirm, /me
- `/api/gmail/{status,connect,callback,sync,disconnect}`

## Email

Reminders, tracker invites, and member-nudge emails all flow through `modules/auth/email.send_email`.
Emails carry `List-Unsubscribe` + `List-Unsubscribe-Post` headers (Gmail/Outlook one-click compliance)
and a stable per-user-per-scope unsubscribe token. The user-facing email preferences page lives at
`/settings/email` in the web app.

## Gmail sync

1. Web app → avatar menu → Profile → Connect Gmail
2. Complete the OAuth flow
3. Click **Sync** (or wait for the cron — auto-syncs on dashboard load if last sync >12h)

## Build & deploy

### Frontend (Netlify)

```bash
cd frontend
npm run build
```

In Netlify: build command `npm run build`, publish directory `dist`. Env vars:

```env
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
VITE_API_BASE=https://your-backend.example.com/api
```

### Backend (Render / Fly / any Docker host)

The Dockerfile pins `python:3.13-slim`; `runtime.txt` does the same for Render's
non-Docker buildpack. Required env on the host:

```env
DATABASE_URL=...
JWT_SECRET_KEY=...
FRONTEND_URL=https://your-site.netlify.app
CORS_ORIGINS=https://your-site.netlify.app
BACKEND_URL=https://your-backend.example.com
RESEND_API_KEY=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
CRON_SECRET=...
```

### Mobile APK (EAS)

```bash
npm install -g eas-cli
eas login
cd mobile
eas build --platform android --profile preview
```

## What's tracked vs. ignored

These are **never** committed (see [.gitignore](.gitignore)):
- `backend/venv/`, `backend/.env`, `backend/__pycache__/`, `.mypy_cache`, `.pytest_cache`
- `frontend/node_modules/`, `frontend/dist/`, `frontend/.env*`
- `mobile/node_modules/`, `mobile/.expo/`, `mobile/android/`, `mobile/ios/`, `*.aab`/`*.apk`/`*.ipa`
- `.next/`, `.turbo/`, `.parcel-cache/`, `.cache/` (build caches that occasionally leak in)
- `.claude/`, `**/settings.json`, `.vscode/`, `.idea/` (per-machine tool config)
- `.DS_Store`, `Thumbs.db`

These **are** in the repo:
- `.github/workflows/` — keep-warm pinger + nightly digest cron + CI
- `backend/Dockerfile`, `backend/runtime.txt` — deployment runtime (Python 3.13)
- `backend/migrations/*.sql` and `backend/modules/*/migration.sql` — schema source-of-truth

## Google Cloud setup

1. Create a project in Google Cloud Console
2. Enable the **Gmail API**
3. Create an OAuth 2.0 **Web** client
4. Add authorised JavaScript origins (`http://localhost:5173`, your Netlify domain)
5. Add redirect URIs: `http://localhost:5000/api/gmail/callback` and your prod backend's equivalent
6. Drop the client ID + secret into `backend/.env` and `frontend/.env`
