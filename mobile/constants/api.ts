// ── Update this to your backend URL ──────────────────────────────────────────
// Local dev (same WiFi):  http://192.168.x.x:5000/api
// ngrok:                  https://xxxx.ngrok-free.app/api
// Production:             https://yourdomain.com/api
export const API_BASE = 'http://192.168.1.8:5000/api';

// Web OAuth client ID (from Google Cloud Console → Credentials → Web client)
export const GOOGLE_CLIENT_ID = '21187440512-7h8lpgfs8ttk4efti67s1otjj57ufoi2.apps.googleusercontent.com';

// Android OAuth client ID — create one in Google Cloud Console → Credentials → Android.
// Package name: com.subtracker.app  |  SHA-1: from your debug/release keystore.
// Leave empty until you have an Android client set up.
export const GOOGLE_ANDROID_CLIENT_ID = '';
