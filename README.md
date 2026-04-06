# SubTracker

A personal finance dashboard to track subscriptions, EMIs, credit cards, bank accounts, receivables, CapEx, and rent — with smart card-payment allocation and Gmail auto-sync.

## Features

- **Dashboard** — net liquidity, CC outstanding, monthly spend breakdown, smart allocation
- **Credit Cards** — outstanding, minimum due, due dates, per-card transactions & statements
- **Subscriptions & EMIs** — recurring expenses with due-day tracking
- **Bank Accounts** — balance tracking across multiple accounts
- **Receivables & CapEx** — expected inflows and planned spends
- **Smart Allocation** — recommends which bank account to pay each CC from
- **Gmail Sync** — connects to Gmail to auto-import CC transaction alerts and statements
- **Mobile App** — React Native (Expo) app for Android

## Stack

| Layer | Tech |
|-------|------|
| Web frontend | React 18 + TypeScript + Vite + TailwindCSS |
| Mobile | React Native + Expo 52 + Expo Router |
| Backend | Flask + Flask-JWT-Extended + Flask-CORS |
| Database | PostgreSQL (Supabase) |
| Auth | Email/password + Google SSO |
| Gmail | Google OAuth 2.0 (gmail.readonly) |

## Repository Layout

```
backend/          Flask API
frontend/         React web app
mobile/           Expo mobile app (Android)
```

## Prerequisites

- Python 3.8+, Node.js 18+
- PostgreSQL database (or Supabase project)
- Google Cloud project with OAuth 2.0 credential

## Environment Setup

### `backend/.env`

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET_KEY=long-random-secret

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=you@gmail.com

BACKEND_URL=http://localhost:5000
FRONTEND_URL=http://localhost:5173

GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx

SKIP_EMAIL_CONFIRMATION=true
GMAIL_SYNC_LOOKBACK_DAYS=30
```

### `frontend/.env`

```env
VITE_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
```

### `mobile/constants/api.ts`

Update `API_BASE` to your backend's LAN IP or deployed URL.

## Local Development

### Backend

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python seed.py    # first time only
python app.py
```

Runs on `http://localhost:5000`.

### Web Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173`. Vite proxies `/api` to the backend.

### Mobile

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your Android device.

> Set `API_BASE` in `mobile/constants/api.ts` to your machine's LAN IP, e.g. `http://192.168.1.8:5000/api`.

## Database Migrations

Run any migration SQL file against your database:

```bash
cd backend && source venv/bin/activate
python -c "
from dotenv import load_dotenv; load_dotenv()
import os, psycopg2
conn = psycopg2.connect(os.environ['DATABASE_URL'])
conn.autocommit = True
conn.cursor().execute(open('migrations/<file>.sql').read())
conn.close(); print('Done')
"
```

## API

All responses: `{ "data": <payload>, "error": <string|null> }`

All routes except `/api/auth/*` and `/api/gmail/callback` require:
`Authorization: Bearer <jwt>`

Prefixes: `/api/auth`, `/api/gmail`, `/api/cards`, `/api/subscriptions`, `/api/emis`, `/api/accounts`, `/api/receivables`, `/api/capex`, `/api/rent`, `/api/smart-allocation`

## Gmail Sync

1. Open the **web app** → My Account → Connect Gmail
2. Approve Google OAuth (read-only access)
3. Click **Sync Now** to import CC emails
4. On mobile, tap **Sync Now** in Profile tab after connecting via web

## Building & Distributing the APK

### Quick share (APK via EAS Build)

The fastest way to build a shareable `.apk` without Android Studio:

```bash
npm install -g eas-cli
eas login
cd mobile
eas build --platform android --profile preview
```

EAS returns a public download URL when the build completes. Share it directly — anyone can download and sideload it (requires *Install unknown apps* enabled on the device).

Ensure `mobile/eas.json` has a `preview` profile that outputs an APK:

```json
{
  "build": {
    "preview": {
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

### Distribute via Firebase App Distribution (optional)

For organized tester management with install prompts and version history:

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com) and enable **App Distribution**.
2. Build the APK using EAS (above) and download it.
3. Upload and notify testers:

```bash
npm install -g firebase-tools
firebase login
firebase appdistribution:distribute path/to/app.apk \
  --app YOUR_FIREBASE_APP_ID \
  --testers "tester1@email.com,tester2@email.com" \
  --release-notes "What changed in this build"
```

Testers receive an email with a direct install link.

### Play Store Deployment

```bash
npm install -g eas-cli
eas login
cd mobile
eas build --platform android --profile production
```

Upload the `.aab` to [Google Play Console](https://play.google.com/console).

Requirements: Expo account (free) + Google Play Developer account ($25).

## Smart Allocation Logic

1. Sorts cards by nearest due date
2. Prefers same-bank accounts first
3. Falls back to other non-cash accounts
4. Returns allocation rows, post-payment balances, and summary

## Google Cloud Setup

1. Create project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable **Gmail API**
3. Create OAuth 2.0 Client ID (Web application)
4. Add redirect URI: `http://localhost:5000/api/gmail/callback`
5. Copy Client ID/Secret to `backend/.env` and `frontend/.env`
