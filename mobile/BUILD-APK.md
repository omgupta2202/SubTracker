# Building a SubTracker APK / AAB

There are three production-quality build paths plus the `production` profile
for Play Store releases. Pick based on the goal.

| Path | Output | Use when | Needs | Speed |
|---|---|---|---|---|
| **A. EAS cloud — preview** | Shareable `.apk` | Direct-share link, side-loading | `eas-cli` + Expo account | 5-15 min queue |
| **B. EAS cloud — production** | Play-Store-ready `.aab` | Listing on Google Play | `eas-cli` + Expo account + Play console | 5-15 min queue |
| **C. EAS local** | `.apk` or `.aab` | Faster turn-around / no upload | `eas-cli` + Android SDK + JDK 17 | ~5 min |
| **D. Plain Gradle** | `.apk` (debug or release) | You already do Android | Android SDK + JDK 17 | ~3 min |

The native `android/` folder, `eas.json`, debug keystore, and npm scripts are
already wired. Just pick a path.

---

## Path A — EAS cloud, preview APK (easiest to share)

**One-time setup**

```bash
npm install -g eas-cli
eas login                 # uses your Expo account
```

**Build**

```bash
cd mobile
npm run build:android:preview
# equivalent to: eas build --platform android --profile preview
```

What this does:
- Uploads your project to Expo's build servers.
- Builds an `.apk` with the `preview` profile from `eas.json`.
- When done, prints a URL like `https://expo.dev/artifacts/.../app.apk`.

**Distribute** — share that URL. Anyone can open it on Android, allow "Install from unknown sources" once, and install.

**Notes**
- Free Expo tier has a queue — usually 5-15 min on weekdays.
- This APK is signed with EAS's per-app debug-style key — fine for sharing,
  but Google Play won't accept it. For Play Store use Path **B** (production).

---

## Path B — EAS cloud, production AAB (Play Store)

This is the official path for shipping to Google Play. It produces an Android
**App Bundle (`.aab`)**, signed with your app's release key (managed by EAS or
your own keystore), ready to upload through Play Console.

**One-time setup**

1. Install + login (same as Path A).
2. Make sure `eas.json` has a `production` profile (already wired):
   ```jsonc
   {
     "build": {
       "production": {
         "android": { "buildType": "app-bundle" }
       }
     }
   }
   ```
3. Pick a credentials strategy when EAS asks during the first run:
   - **EAS-managed key** (recommended) — EAS generates and stores the keystore.
     Lose nothing, no manual cert juggling.
   - **Local keystore** — You provide the JKS and passwords; EAS uses them
     unchanged. Use this if you've already published under that key from a
     non-Expo build.

**Bump the version**

Increment `version` and `android.versionCode` in [`mobile/app.json`](app.json)
on every release. Play Console refuses uploads with a duplicate
`versionCode`.

```jsonc
// mobile/app.json
{
  "expo": {
    "version": "1.2.0",
    "android": {
      "package": "com.subtracker",
      "versionCode": 14
    }
  }
}
```

**Build**

```bash
cd mobile
npm run build:android:production
# equivalent to: eas build --platform android --profile production
```

When done, EAS prints a download URL for the `.aab`.

**Submit to Play Store**

Two options — pick one.

1. **EAS submit** (zero-friction once configured):
   ```bash
   eas submit --platform android --latest
   ```
   This uploads the most recent build to the Play Console internal/closed
   track you've pre-configured in `eas.json` → `submit.production.android`.
   Needs a Google Cloud service-account JSON key with Play Developer API
   permissions; see [Expo's docs](https://docs.expo.dev/submit/android/).

2. **Manual upload**: download the `.aab` from the EAS URL, open Play
   Console → your app → Production / Internal testing → "Create new release"
   → upload, write release notes, submit for review.

**Crash log + ongoing iteration**

- Each new build needs a higher `versionCode` than the one before it on
  any track that's already been promoted.
- If you change the package name (`android.package`) you can't update the
  existing listing — it's a brand-new app to Play Store.
- Play Console signs the APKs delivered to users with a Google-managed
  upload key by default. Don't change this once chosen — you'll lose the
  ability to ship updates.

---

## Path C — EAS build, but locally

Same toolchain as B/A, no upload to Expo.

**Setup** (one-time)

1. Install JDK 17 (Android requires this version):
   ```bash
   brew install --cask temurin@17
   export JAVA_HOME=$(/usr/libexec/java_home -v 17)
   ```
2. You already have `ANDROID_HOME` set (`~/Library/Android/sdk`).
3. Install eas-cli: `npm install -g eas-cli`

**Build**

```bash
cd mobile
eas build --platform android --profile preview     --local   # APK
eas build --platform android --profile production  --local   # AAB
```

Output drops next to `mobile/` as `build-XXXX.apk` (or `.aab`).

---

## Path B — EAS build, but locally

Same toolchain, no upload.

**Setup** (one-time)

1. Install JDK 17 (Android requires this version):
   ```bash
   brew install --cask temurin@17
   export JAVA_HOME=$(/usr/libexec/java_home -v 17)
   ```
2. You already have `ANDROID_HOME` set (`~/Library/Android/sdk`).
3. Install eas-cli: `npm install -g eas-cli`

**Build**

```bash
cd mobile
eas build --platform android --profile preview --local
```

Output: `<project>/build-XXXX.apk` in the mobile directory. Drag onto a phone
via cable or send via Drive/email.

---

## Path C — Plain Gradle (fastest, no Expo account)

Because `expo prebuild` has already produced the `android/` folder, you can
build like any standard React Native project.

**Setup** (one-time)

1. Install JDK 17 — same as Path B.
2. `ANDROID_HOME` must point to your SDK with `platform-tools` and `build-tools` 34+.

**Debug APK** (signed with Android's universal debug key — installs on any device)

```bash
cd mobile/android
./gradlew assembleDebug
```

Output: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

Send that file via Drive / WhatsApp / USB cable. On the receiving Android,
enable "Install from unknown sources" once, tap the APK, install.

**Release APK** (signed with your own keystore — better for distribution)

1. Generate a keystore once:
   ```bash
   keytool -genkeypair -v -storetype PKCS12 \
     -keystore mobile/android/app/subtracker-release.keystore \
     -alias subtracker -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Add this to `mobile/android/gradle.properties` (replace placeholders):
   ```
   SUBTRACKER_UPLOAD_STORE_FILE=subtracker-release.keystore
   SUBTRACKER_UPLOAD_KEY_ALIAS=subtracker
   SUBTRACKER_UPLOAD_STORE_PASSWORD=YOUR_STORE_PASSWORD
   SUBTRACKER_UPLOAD_KEY_PASSWORD=YOUR_KEY_PASSWORD
   ```
3. Wire signing in `mobile/android/app/build.gradle` — add inside `android { ... }`:
   ```gradle
   signingConfigs {
       release {
           storeFile file(SUBTRACKER_UPLOAD_STORE_FILE)
           storePassword SUBTRACKER_UPLOAD_STORE_PASSWORD
           keyAlias SUBTRACKER_UPLOAD_KEY_ALIAS
           keyPassword SUBTRACKER_UPLOAD_KEY_PASSWORD
       }
   }
   buildTypes {
       release {
           signingConfig signingConfigs.release
           // ... existing release options
       }
   }
   ```
4. Build:
   ```bash
   cd mobile/android
   ./gradlew assembleRelease
   ```

Output: `mobile/android/app/build/outputs/apk/release/app-release.apk`

> Don't commit the keystore or its passwords. Keep them out of git.
> If you lose the keystore, you can never publish updates to Play Store under
> the same package name.

---

## Recommended quick path for sharing with a friend right now

```bash
cd mobile/android
./gradlew assembleDebug
ls -lh app/build/outputs/apk/debug/app-debug.apk
```

Send that APK file. Done in ~3 minutes the first time, ~30 seconds on rebuilds.

---

## Backend reachability

The APK runs on your friend's phone, but it still calls the backend. Update
`mobile/constants/api.ts` to a publicly reachable backend URL **before**
building:

```ts
// mobile/constants/api.ts
export const API_BASE = "https://YOUR-BACKEND-DOMAIN/api";
// localhost / LAN IPs won't work on someone else's network.
```

Quick fix for casual testing — use ngrok against your local backend:

```bash
ngrok http 5000
# copy the https://xxxx.ngrok-free.app URL into API_BASE
```

Then rebuild the APK.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `error: package R does not exist` | Wrong JDK. Use 17, not 21+. `java -version` |
| `SDK location not found` | Set `ANDROID_HOME=~/Library/Android/sdk` and add `platform-tools` to PATH |
| `Execution failed for task ':app:processDebugManifest'` | Run `cd mobile/android && ./gradlew clean` then retry |
| App opens but instantly crashes | Backend URL unreachable — see "Backend reachability" |
| `Install blocked` on phone | Enable "Install unknown apps" for whichever app you're opening the APK from (Drive, WhatsApp, browser) |
