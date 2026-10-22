# HereMate M1.1B — Android native Google Login / Guest account linking

Tracking: https://github.com/chaithawat03/HereMate/issues/23

## Verified inputs (22 Oct 2026)
Owner-provided Firebase Project Settings screenshot and downloaded `google-services.json`:
- Firebase staging project: `heremate` / project number `976775896533`
- Registered Android app: `com.chaithawat03.heremate` / `1:976775896533:android:a34f7f3aa147c2bcaa315c`
- Original internal EAS APK signing SHA-1 `20:3F:89:BB:96:A2:0C:39:A1:57:34:16:11:DA:CB:5D:EA:D8:8D:15`, matching Android OAuth credential in provided JSON.
- Web OAuth Client ID extracted from OAuth client type 3 and pinned in `src/config/googleStaging.ts`. Not a client secret.
- Google provider in Firebase Authentication was previously enabled by owner; screenshot provided here does NOT independently reconfirm its current status.

## Implementation
- `@react-native-google-signin/google-signin@16.1.5` original/free module with Android native picker (Google Play Services); Expo SDK 57 config plugin and `android.googleServicesFile`.
- The downloaded `google-services.json` is public client configuration (contains non-secret Firebase API key/client IDs), not a Firebase Admin credential or password. Never store real tokens or service account JSON in the repo.
- Enable `EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN=true` **only** on `android-guest-staging`; not on `android-preview`, iOS or Production. Legacy iOS Hermes exports remain supported, with an inactive fallback native provider.
- Guest presses **เชื่อม Google**: native picker obtains ID token and M1.1A `linkWithCredential` keeps existing Guest UID and profile. Signed out presses **เข้าสู่ระบบด้วย Google**: uses `signInWithCredential`. Signed-in other-provider and Google credential collision fail closed: no implicit account merges or data migration.
- No additional personal data stored, no raw token logging, no GPS sharing, and existing Firestore owner-only rules unchanged. No account switching on collision.
- Android Google Sign-In free Original SDK uses legacy Google Sign-In SDK (deprecated but functional). Future Android Credential Manager migration belongs in a separate tested task.

## Release gates and real Android acceptance
1. New PR: pass Foundation, Firebase Emulator, Mobile TypeScript, Android/iOS Metro and dependency audit; reviewed SHA and staging-only security snapshot (expiry 20 Nov 2026).
2. Merge and freshly build Android staging APK using same EAS signing credential; verify build logs + generated APK upload to private Google Drive. Re-check APK SHA-1 against the registered Android OAuth certificate; a rotated key breaks Google login.
3. Test on physical Android: Guest login, create private profile, **เชื่อม Google**, confirm UID unchanged and profile still readable; sign out, use **Google Login**, confirm SAME UID and profile returns after reinstallation where applicable.
4. Test fresh signed-out Google login using another Google account; verify separate UID/profile. Try link Guest to an already-used Google account: show collision, remain Guest and keep Guest profile.
5. Test denied/cancelled Google chooser and offline/Play Services failure. Never post ID tokens, account email, real GPS, or credentials in videos/logs.
6. Production and iOS native Google OAuth are NOT enabled. Phone+Password still awaits separately deployed Cloud Run backend.

## Known limitations
- Build/CI does not verify real Google authentication; physical device and Firebase Auth Console checks remain required.
- Only one signing SHA-1 in supplied JSON. Google Play delivery may use different production signing cert, which is not authorized here.
- Android Credential Manager modernization is deferred. This does not block the minimum viable internal APK test.

Official docs: https://react-native-google-signin.github.io/docs/setting-up/expo and https://react-native-google-signin.github.io/docs/original .
