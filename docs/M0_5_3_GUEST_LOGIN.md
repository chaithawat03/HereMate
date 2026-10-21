# M0.5.3 — Native Android Guest Login Candidate (REVIEW REQUIRED)

Owner Firebase Console evidence (21 Oct 2026): Authentication providers **Google and Anonymous enabled**; Firestore `(default)` in **asia-southeast1**, live Rules UI shows `allow read, write: if false` for all documents. Real Emulator deny-all test PR #17 PASS. Google login itself is NOT implemented by this candidate; the first requested physical test is **Anonymous Guest login on Z Fold7**.

## Product-first implementation
- Adds `src/auth/firebaseGuest.ts` using Firebase JS SDK Auth and React Native AsyncStorage v2 default-export persistence (`getReactNativePersistence(AsyncStorage)`).
- A guest is **NOT created automatically**: user chooses `เข้าใช้งานแบบ Guest`, which calls `signInAnonymously()`. Session changes are observed by `onAuthStateChanged()`, user can `signOut()`. UID in the UI is truncated. No phone, Google OAuth or Firebase DB is accessed.
- The existing synthetic Demo Map/Friends UI remains intact and remains the **default** on the prior `android-preview` and `ios-simulator` EAS build profiles.
- Adds isolated EAS `android-guest-staging` APK and `ios-guest-simulator` profiles, explicitly setting `EXPO_PUBLIC_ENVIRONMENT=staging` and `EXPO_PUBLIC_ENABLE_FIREBASE_GUEST=true` to opt in.
- Asynchronous persistence uses **AsyncStorage (unencrypted)**; this is for low-risk Guest device testing only, not a secure password storage solution. Firebase tokens are managed by Firebase SDK and are not copied into app state. A signed-out Guest without a linked account may not regain the same UID.
- Staging source pins `heremate` project. No GPS permission is requested, and Firestore, RTDB, map updates are still simulated.

## Expo + Firebase 13 React Native TypeScript compatibility

On the owner's Cloud Shell (2026-10-21), `npm ls --depth=0` confirmed `firebase@13.0.0` and `@react-native-async-storage/async-storage@2.2.0` on this branch, but `tsc --noEmit` initially failed with **TS2305: `firebase/auth` has no exported member `getReactNativePersistence`**. This is a known discrepancy: Firebase's default Web-facing TypeScript declarations can omit the documented React Native-specific persistence export even when the Metro React Native runtime entry supports it.

`src/types/firebase-auth-react-native.d.ts` supplies a **scoped, explicitly typed** declaration for that documented React Native export. The implementation remains `getReactNativePersistence(AsyncStorage)` for AsyncStorage **v2** (do not use v3-only `createAsyncStorage`). This is a TYPE declaration only; it is **not** a runtime polyfill. Test on Android native Expo bundle and physical device before claiming persistence works; if Metro resolves the Web Firebase Auth runtime, the declaration alone cannot fix that. Avoid import from private SDK distribution paths, `any`, or disabling TypeScript checks.

Owner should pull the updated PR branch preserving uncommitted root package and lockfile, run `npm run typecheck`, `node --test tests/m0-5-guest-auth.test.mjs`, and `npm test`. If successful, commit package.json + package-lock.json on the branch for full npm CI. DO NOT merge while this remains a Draft and the staging-only security exception is unresolved.

## **BLOCKING** until dependency lock/security and CI are verified
The original M0.1 Security Exception tracks an *exact file snapshot* and applies **only to synthetic-data staging**. This new feature will generate real Firebase Anonymous Auth records and requires both a new root Firebase dependency tree and root Expo file changes. **Do not merge this branch, start a real Guest APK, bypass audit checks or broaden the old Security Exception** until a revised security review explicitly authorizes narrow staging Guest auth testing.

Root dependencies and `package-lock.json` MUST be generated together using `npx expo install firebase @react-native-async-storage/async-storage`, tested against Expo SDK 57 and React Native 0.86. **They are not provided in this candidate until a reproducible lockfile is generated**. Firebase web Analytics is not supported in the Native JS SDK; do NOT add `getAnalytics`, Hosting or custom domain.

After lockfile generation, the PR needs:
1. Version-compatible `@react-native-async-storage/async-storage` + Firebase JS SDK, npm CI build and Metro export Android + iOS.
2. Audit remediation or a newly reviewed narrow staging-only security risk decision for real **Guest Auth only**, never Phone+Password credentials or GPS; the previous synthetic-only exception stays unchanged unless explicitly approved and verified. The `braces` advisory might remain unpatched upstream; don't invent a patched version.
3. Use physical-device testing on Z Fold7 to check user-initiated anonymous sign-in, persisted UID after force-quit and reopen, sign-out, no leaked GPS/Firestore access, and folding/unfolding UI.
4. New staging preview build manually, after merged/main CI PASS; existing `android-preview` pipeline unchanged. No Production build.
5. Only when verified, plan Google Sign-in and account linking (avoid automatic phone-based merges).

### Reproduction steps for owner after PR candidate is created

In Google Cloud Shell, work on the **dedicated candidate branch**, NOT `main`:

```bash
cd ~/HereMate
git fetch origin
git switch --track origin/feat/m0-5-3-guest-auth-device-candidate
npx expo install firebase @react-native-async-storage/async-storage
npm run typecheck
npm test
```

If typecheck and tests pass, commit **both** package and lockfile on the candidate branch, push to GitHub, and let CI rerun. No need to send secret, OAuth token, or account credentials to chat.

The security/audit review and PR merge MUST still happen before any EAS build or actual account creation.

References:
- https://docs.expo.dev/guides/using-firebase/
- https://firebase.google.com/docs/reference/js/auth
- https://github.com/react-native-async-storage/async-storage/blob/main/docs/migration-to-3.md
