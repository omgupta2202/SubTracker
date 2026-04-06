# SubTracker

SubTracker is a personal finance dashboard with a ledger-first backend architecture.

It tracks:
- Financial accounts (bank/wallet/cash/credit card)
- Recurring obligations (subscriptions/EMIs/rent)
- Receivables and CapEx plans
- Dashboard analytics and smart payment allocation
- Gmail ingestion for card transaction/statement extraction

## Stack

| Layer | Tech |
|---|---|
| Web | React 18 + TypeScript + Vite + TailwindCSS |
| Mobile | React Native + Expo |
| Backend | Flask + Flask-JWT-Extended + Flask-CORS |
| DB | PostgreSQL |
| Auth | Email/password + Google SSO |

## Repo Layout

```text
backend/    Flask API + services + migrations
frontend/   Web app
mobile/     Expo app
```

## Prerequisites

- Python 3.8+
- Node.js 18+
- PostgreSQL database
- Google OAuth credentials (for Gmail + Google login)

## Environment

### `backend/.env`

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET_KEY=long-random-secret

BACKEND_URL=http://localhost:5000
FRONTEND_URL=http://localhost:5173

GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=you@gmail.com

SKIP_EMAIL_CONFIRMATION=true
GMAIL_SYNC_LOOKBACK_DAYS=30
```

### `frontend/.env`

```env
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
```

## Run Locally

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python seed.py      # first-time setup
python app.py
```

Backend runs on `http://127.0.0.1:5000`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:5173`.

### Mobile

```bash
cd mobile
npm install
npx expo start
```

Set `mobile/constants/api.ts` `API_BASE` to your backend URL.

## Database Migrations

Apply SQL migrations manually:

```bash
cd backend
source venv/bin/activate
python -c "
from dotenv import load_dotenv; load_dotenv()
import os, psycopg2
conn = psycopg2.connect(os.environ['DATABASE_URL'])
conn.autocommit = True
cur = conn.cursor()
cur.execute(open('migrations/ledger_architecture.sql').read())
conn.close()
print('Done')
"
```

If migrating existing legacy data:

```bash
cd backend
source venv/bin/activate
python migrations/data_migration.py
```

## API Notes

All responses are wrapped as:

```json
{ "data": <payload>, "error": <string|null> }
```

All routes except `/api/auth/*` and `/api/gmail/callback` require:

```text
Authorization: Bearer <jwt>
```

## Route Groups

### New (ledger architecture)
- `/api/financial-accounts`
- `/api/ledger`
- `/api/payments`
- `/api/obligations`
- `/api/billing-cycles`
- `/api/smart-allocation`
- `/api/dashboard`
- `/api/daily-logs`

### Legacy (kept for compatibility)
- `/api/subscriptions`
- `/api/emis`
- `/api/cards`
- `/api/accounts`
- `/api/receivables`
- `/api/capex`
- `/api/rent`
- `/api/snapshots`

## Gmail Sync

1. Open web app → Profile → Connect Gmail
2. Complete OAuth flow
3. Click Sync to process emails

## Build

### Frontend production build

```bash
cd frontend
npm run build
```

### Mobile APK (EAS)

```bash
npm install -g eas-cli
eas login
cd mobile
eas build --platform android --profile preview
```

## Google Cloud Setup

1. Create project in Google Cloud Console
2. Enable Gmail API
3. Create OAuth 2.0 Web client
4. Add redirect URI: `http://localhost:5000/api/gmail/callback`
5. Set client ID/secret in env files
