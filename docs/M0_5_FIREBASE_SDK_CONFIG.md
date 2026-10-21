# M0.5.2 — HereMate Firebase SDK application configuration

Current status: **registered, configuration staged in code, NOT initialized or used by the mobile app**.

Owner-verified Firebase Console on 2026-10-21:
- Google Cloud/Firebase project: `heremate`, number `976775896533`, Blaze.
- Native Android app: `HereMate Android Staging`, package `com.chaithawat03.heremate`, Firebase app ID `1:976775896533:android:a34f7f3aa147c2bcaa315c`.
- Firebase web configuration app: `HereMate SDK Configuration`, app ID `1:976775896533:web:c71784a039e43386aa315c`. **This is only a Firebase JS SDK configuration record, NOT a website, Firebase Hosting or custom-domain requirement.**
- Firebase JS SDK config fields are typed in `src/config/firebaseStaging.ts`, project-identity validated, and use public Firebase config only. No OAuth Client Secret, Refresh Token or Service Account Key in code.
- Firebase Analytics `getAnalytics(app)` from Firebase Console's generic Web snippet is **not suitable** for the React Native JS SDK implementation; omit `measurementId` and Analytics from Native scope.

## Why we do not initialize Firebase yet
The Expo Android/iOS app and `package-lock.json` are protected by the **synthetic-data-only M0.1 staging Security Exception**, which explicitly forbids Auth, user records and live GPS. It expires 2026-11-20. This initial config-only PR does not modify `App.tsx`, `app.json`, `package.json`, `package-lock.json`, or `security/staging-exceptions.json`. No Firebase network calls, credentials, phone numbers or GPS data.

After owner confirms budget alert and Firestore/RTDB/Authentication staging security plan, a *separate reviewed PR* will:
1. Resolve/reevaluate existing dependency vulnerabilities and replace the synthetic-data-only security exception before Auth/personal data.
2. Install Expo-compatible Firebase JS SDK (`npx expo install firebase`) and a version-compatible React Native persistence adapter; commit a consistent lockfile.
3. Initialize `firebase/app` with the verified `firebaseConfig`, and `firebase/auth` with React Native `AsyncStorage` persistence (avoid memory-only auth sessions).
4. Configure secure Firebase Authentication providers and a Cloud Run custom-token flow with server-side password verification as an explicitly reviewed feature. Client app NEVER stores or verifies phone passwords locally.
5. Add Firestore/RTDB rules denying unauthorized access, with emulator-based isolation tests **before enabling live user data**.
6. Verify Android physical login and logout, retain iOS shared-code compatibility, no Production release.

## Firebase key safety
Firebase client API keys are public by design, **not** credentials for authorizing access to Firestore/RTDB. Confirm its Google Cloud API restrictions include only necessary Firebase APIs and enforce Firebase Security Rules / App Check as required. Public API key must not be reused for Maps or other Google APIs. No real data collection exists in this PR.

References:
- https://docs.expo.dev/guides/using-firebase/
- https://firebase.google.com/docs/projects/api-keys
- https://firebase.google.com/docs/reference/js/auth
