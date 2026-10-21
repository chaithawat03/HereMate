# M0.5.3 — Backend-only Firestore Login Adapters

Tracking: [M0.5 #12](https://github.com/chaithawat03/HereMate/issues/12).
Owner-supplied Firebase Console screenshot (2026-10-21) confirms:
- Project `heremate` (number `976775896533`) has Authentication enabled.
- **Google** and **Anonymous** are both ENABLED.
- `Phone` and `Email/Password` Firebase sign-in providers remain OFF by design. No SMS OTP for V1. Phone+Password will be server-verified and converted into a Firebase Custom Token via Firebase Admin.

## Implemented in this change

`backend/auth/firestore-adapters.mjs` supplies actual Firestore/Firebase Admin **adapter logic** to the existing `createPhoneLoginService()` pure domain contract:
- `accountStore.findByPhoneDigest()`: reads backend-only `private_phone_auth/{hmac_sha256_digest}` document by opaque server-peppered lookup key. Returns only Firebase UID, Argon2id password hash and account status. No plaintext phone or client role/claims.
- `rateLimiter.consume()`: **Firestore transactional** per-phone and per-trusted-source 15-minute buckets; limits 5/phone and 30/source. The source identity **must be derived by a trusted ingress and cannot come from the client body or spoofable headers**. Read/commit failures and corrupt counters fail closed; optional TTL is cleanup only.
- `tokenIssuer.assertAccountEnabled()`: queries Firebase Admin getUser, rejects disabled/missing users. The issuer calls `createCustomToken(uid)` using the server UID alone, never user-provided claims.
- Least privilege: Firebase Admin SDK bypasses Firestore client Rules; the Cloud Run runtime service account must receive only IAM permissions required for its exact collections and token signing. Rules alone are insufficient for backend access control.
- Hard pinning: `firestore.projectId` and `adminAuth.app.options.projectId` must each equal `heremate`. A production project or missing app setting blocks construction.
- `firebase/firestore.rules` contains a deny-all placeholder for mobile/JS clients, including private credentials and rate-limit counters. It is *not yet deployed* and permits **no** client data operations.
- Node tests simulate Firestore document operations and transaction interfaces with synthetic accounts. This does **not** prove distributed concurrency semantics or emulator Rule behavior.

## Current status
- Auth providers Google and Anonymous: **CONSOLE CONFIG VERIFIED**, not tested on device.
- Firestore/Admin adapter logic: **CODE IMPLEMENTED + SYNTHETIC UNIT TESTS**.
- Firebase Admin SDK dependency / Runtime Cloud Run transport and IAM: **NOT DEPLOYED**.
- Firestore Rules: **NOT DEPLOYED**.
- Firebase emulator tests: **NOT EMULATOR TESTED**. Static checks are not a substitute.
- Persistent database `private_phone_auth` collections: **NOT PROVISIONED**.
- `Guest signInAnonymously` and Google Credential sign-in on actual Android phone: **NOT IMPLEMENTED / NOT TESTED**.
- Production: **NOT AUTHORIZED**.

## Required next steps before collecting real users' passwords
1. Owner selects/creates Staging Firestore database in `heremate` project (initial proposal region `asia-southeast1` Singapore). Confirm region beforehand; database location cannot be freely changed in place.
2. Add dedicated backend runtime package and lockfile, with audited `firebase-admin`, `argon2`, and appropriate server framework. Resolve/review existing Expo M0.1 synthetic-only security exception separately; no blanket exception for Auth or GPS.
3. Implement **idempotent/atomic signup provisioning** and account recovery; verify no duplicate UID, no customer enumeration, and no password reset by unverified phone. Integrate Firestore Admin adapter only from protected Cloud Run server. Backend may access Firestore Admin outside Rules and thus needs narrow IAM.
4. Build Firebase Emulator Suite integration tests for Firestore Rules, client/guest/Google cross-account access, rate limiter concurrency and credential isolation. Current deny-all policy alone is not evidence of real emulator PASS.
5. Only after security tests, deploy the dedicated authenticated API to **Staging Cloud Run** with secrets in GCP Secret Manager, KMS/managed signing as appropriate. Expose public login endpoint with abuse protection and trusted source derivation; use no SA JSON keys and never log phones/passwords/tokens.
6. Install Firebase JS SDK (`firebase >=12` per Expo documentation) and compatible React Native AsyncStorage persistence, perform real Android Guest login test, then Google account linking; integrate Phone+Password only once Cloud Run is hardened.

## Project-first scope discipline
No custom domain or Google Drive OAuth work is needed for M0.5.3. Billing 50 THB/month is an alerts-only budget; owner's instruction is that above-threshold spend does not block approved development. Never imply the budget is a hard cap. Do not deploy Production.
References:
- https://firebase.google.com/docs/auth/admin/create-custom-tokens
- https://firebase.google.com/docs/firestore/security/rules-query
- https://firebase.google.com/docs/firestore/security/iam
- https://docs.expo.dev/guides/using-firebase/
