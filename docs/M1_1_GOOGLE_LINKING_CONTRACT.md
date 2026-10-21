# HereMate M1.1A — Safe Google account linking contract (staging, inert)

Tracking: https://github.com/chaithawat03/HereMate/issues/23

## Implemented now
- A testable Google identity policy for **user-initiated** transitions, no UI call sites yet.
- Signed-out + verified native Google ID token -> Firebase signInWithCredential.
- Anonymous Guest + verified native Google ID token -> Firebase linkWithCredential on the **same Firebase User/UID**. This preserves the M1.0 owner profile under `users/{uid}`.
- Already-Google session -> no-op. Signed-in account using another provider -> no implicit provider change.
- If Google credential belongs to an existing account (credential-already-in-use / email conflict), do NOT call signInWithCredential, migrate profiles, copy user data or sign out. Return collision; a separate explicit account switching/reconciliation flow requires review.
- Session changed while native picker was open -> abort before calling Firebase.
- No OAuth ID tokens, secrets or credential values appear in UI state, logs, databases or test fixtures (only a synthetic test token).
- Existing Guest Login, GPS and M1.0 private profile UI remain exactly unchanged. Existing EAS native builds are unchanged.

## Blocked for real Google Sign-In
**Google Sign-In is NOT enabled in APK yet.** Only the Firebase bridging contract is prepared.

The app needs a native Google token provider compatible with Expo SDK 57 (see Expo Google auth guide). Its config plugin requires a newly signed Android APK build and Google OAuth configuration. To safely enable Android Guest linking:

1. For the existing Android internal APK Build `4724c9aa-f666-4d4a-bff7-31cdb572374f` (source `6a8f2f7`), independently extracted the signing-block v2 X.509 SHA-1 **`20:3F:89:BB:96:A2:0C:39:A1:57:34:16:11:DA:CB:5D:EA:D8:8D:15`**. The downloaded APK SHA-256 matched the trusted manifest **`91aff167b8a5193cd62a3640b235a5a82a82d49bd24f8a50673b04e0bcc2945c`**. Reconfirm the SHA-1 for any newly signed APK or rotated EAS key. SHA-256 alone is insufficient for Google Android OAuth.
2. In Firebase console `heremate` Android App, register that SHA-1 and confirm Google Auth provider is enabled. Obtain the correct Google OAuth **Web Client ID** for requesting an ID token and an Android OAuth client matching the package + SHA-1. Public OAuth *client IDs* are not client secrets.
3. Select, pin and audit a compatible native Google provider, e.g. `react-native-nitro-google-signin` (Android Credential Manager) or `@react-native-google-signin/google-signin` (legacy Android API). Check native config plugin requirements and add `google-services.json` and iOS URL scheme/plist as appropriate. Do not guess this project's client IDs or fake a google-services file.
4. Hook provider's user-action result (Google ID token) into `continueStagingGoogleWithNativeToken`, behind a **Staging-only** flag, show collision/retry without implicit account switch, and test on a newly built physical Android APK.
5. Confirm UID before and after linking and confirm existing Firestore `users/{uid}` profile remains readable and unchanged. Sign out/relaunch and sign in with Google to recover same UID. Test second separate Google account and collision case. Only then mark M1.1 completed.
6. Android internal APK first. iOS native sign-in awaits distinct iOS OAuth config/signing. Production needs separate owner approval.

## Security / rollout
No new permissions, client-side external auth handling, or changes to Firestore rules. Firebase Auth is pinned to Staging. All tests use synthetic identities. Google credentials must never be sent to Cloud Run or manually accepted from a text input. Phone+Password Cloud Run sign-in remains a separate, non-deployed milestone.

Sources:
- https://docs.expo.dev/guides/google-authentication/
- https://react-native-google-signin.github.io/docs/setting-up/expo
- https://react-native-google-signin.github.io/docs/setting-up/get-config-file
- https://firebase.google.com/docs/auth/web/account-linking
