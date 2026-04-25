/**
 * Mobile API base URL — chosen by build environment.
 *
 * The runtime is Expo / React Native, not a browser, so there is no
 * Vite-style auto-loaded .env. We read process.env.EXPO_PUBLIC_API_BASE,
 * which Expo injects from a `.env` file at build time. Anything prefixed
 * with `EXPO_PUBLIC_` is exposed to the client bundle.
 *
 * Order of resolution:
 *   1. EXPO_PUBLIC_API_BASE           (set in mobile/.env.local for dev)
 *   2. Production fallback below     (used when nothing is set, e.g. EAS builds)
 *
 * Local dev workflow:
 *   - Create mobile/.env.local with:  EXPO_PUBLIC_API_BASE=http://192.168.X.X:5000/api
 *     (your laptop's LAN IP, NOT localhost — phones don't share localhost)
 *   - `npx expo start` reads it on launch.
 *
 * Production build (EAS):
 *   - The fallback below is used unless you set EXPO_PUBLIC_API_BASE in
 *     eas.json under the build profile's `env` key.
 */
const PROD_API_BASE = 'https://subtracker-api-n282.onrender.com/api';

export const API_BASE =
  (process.env.EXPO_PUBLIC_API_BASE && process.env.EXPO_PUBLIC_API_BASE.trim())
  || PROD_API_BASE;

// Web OAuth client ID (from Google Cloud Console → Credentials → Web client)
export const GOOGLE_CLIENT_ID = '21187440512-7h8lpgfs8ttk4efti67s1otjj57ufoi2.apps.googleusercontent.com';

// Android OAuth client ID — create one in Google Cloud Console → Credentials → Android.
// Package name: com.subtracker.app  |  SHA-1: from your debug/release keystore.
// Leave empty until you have an Android client set up.
export const GOOGLE_ANDROID_CLIENT_ID = '';
