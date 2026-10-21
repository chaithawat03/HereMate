# M0.5.3 — Android-first Firebase Login / Cloud Run Phone+Password

Parent: [M0.5 Issue #12](https://github.com/chaithawat03/HereMate/issues/12). Owner explicitly authorized M0.5.3 on 2026-10-21. Monthly Billing overage is **NOT a work-blocker**; existing alert-only THB 50/month is retained, not a hard cap. **This PR is a secure, synthetic-data contract, not a deployed login service.**

## Approved V2 identity flows
1. **Phone + Password** (no SMS OTP in V1): Mobile sends credentials via TLS to staging Cloud Run custom authentication API; server verifies credentials in a backend-only store (Argon2id hash), verifies Firebase user is active, returns a short-lived Firebase **Custom Token** minted by Firebase Admin. Mobile uses Firebase JS SDK `signInWithCustomToken(auth, customToken)`, then a Firebase **ID Token** for subsequent authorized APIs. The app **never** verifies or stores phone passwords locally.
2. **Google Sign-in:** Firebase Google provider, with explicit account linking and authentication checks; do not guess identity equivalence from the same phone or display name.
3. **Guest:** Firebase Anonymous Auth creates a real UID. When upgrading, link providers using Firebase's supported linking flow and verified ownership so one user/UID can persist across devices. A guest's anonymous UID must not be silently reassigned to an existing phone account.
4. **No SMS OTP:** Phone possession **is not verified** by Phone+Password registration. Do not mark `phoneVerified=true`, publicly expose/search phone numbers, or permit password resets/account takeover by claiming that an entered phone number proves ownership.
5. **Recovery:** secure, one-time offline Recovery Code or an already-linked Google account. Never recover with unverified phone alone.

## Scope implemented in this PR
- `backend/auth/phone-login.mjs`: dependency-injected login core, strict Thai mobile normalization, peppered HMAC-SHA256 lookup keys (no indexed plaintext phone), guaranteed Argon2id interface, synthetic-account lookup, durable rate limiter interface for **source + account**, active user/UID check, Firebase custom-token issuer. Generic invalid-credential response prevents user enumeration; no Firebase SDK or network calls.
- `backend/auth/http.mjs`: strict POST `/v1/auth/phone/login` and JSON content type, <=2048-byte payload contract, no extra client-supplied UID/role/claims, 401/429/503 safe errors and `Cache-Control: no-store`. **A future Cloud Run transport MUST cap request-body streams at 2048 bytes independently**; this pure contract alone cannot prevent transport-level DoS.
- `tests/m0-5-phone-auth.test.mjs`: synthetic-only unit tests without cloud permissions or network.
- `AGENTS.md`: no production or real-user credential use until adapters and security gates pass.

## Critical adapters required BEFORE deployment
No adapter is implemented or claimed to be running. Cloud Run staging request handler MUST provide:
- `accountStore.findByPhoneDigest`: Firestore backend-only read. A separately reviewed signup/provisioning transaction must reserve the unique HMAC lookup digest atomically, create/repair Firebase Auth UID with idempotency, and store Argon2id password hashes. Design status/rollback behavior before accepting registration to avoid orphaned users or duplicate UIDs.
- `passwordVerifier.verify`: audited Argon2id implementation; minimum OWASP baseline 19 MiB, 2 iterations, parallelism 1; tune to Cloud Run memory. `dummyArgon2idHash` must be a valid precomputed dummy hash of the same work factor. No plaintext or fast SHA-based password storage.
- `rateLimiter.consume`: persistent, transactional/race-safe Firestore (or supported Cloud backend) limiter for source and HMAC phone key. Suggested initial policy: 5 attempts / phone / 15 min and 30 attempts / trusted-source / 15 min, plus Cloud Armor/IP abuse controls and account lockout policy. No per-instance in-memory counters; failure to read/update limiter rejects logins. Make sure Cloud Run proxy/source headers cannot be trivially spoofed. Never use client-provided sourceTag directly.
- `tokenIssuer.assertAccountEnabled`: check current Firebase User is present and not disabled/revoked and mapping UID is valid; `createCustomToken(uid)` via Firebase Admin SDK for **the project heremate**, under a dedicated narrowly-permissioned runtime service account with Google IAM remote signing permissions if needed. Never accept a client-supplied UID/claims; no service-account JSON keys in repository or mobile app.
- Pepper: 32+ random bytes injected securely from a *dedicated* secret, stable across deploys; it must **not** reuse the private Drive OAuth secret or Firebase client API key. Pepper rotation needs a separate safe digest migration plan.
- Deny-by-default Firestore/RTDB Rules for credential collections and cross-user data; only Admin SDK/server can read/write password hashes. Custom Token signing alone DOES NOT grant permission to read anyone else's GPS.
- Do not include request body, raw phone number, credentials, recovery code, bearer token or custom token in Cloud Logging.

## Why Auth is not enabled on the user's current APK yet
HereMate's M0.1 exception `security/staging-exceptions.json` is **synthetic-data-only**, pinned to root `App.tsx`, `package.json`, `package-lock.json`, and source hashes. It expires 2026-11-20 and does **not** cover personal Auth/GPS. This PR intentionally does not change the protected files or activate Firebase SDK. A later reviewed PR must remediate/reassess vulnerabilities, install Firebase JS SDK for Android/iOS with secure persistence, and enable verified deny-by-default Rules/emulator tests **before any real login**.

## Gates to claim M0.5.3 acceptance
- [x] Owner-approved login architecture preserved, with no SMS OTP or accidental phone ownership claim.
- [x] Synthetic login core and HTTP contract unit tests in PR CI.
- [ ] Security-approved transactional account provisioning & durable limiter adapter.
- [ ] Firebase Auth provider enablement for custom token / Google / anonymous as selected.
- [ ] Firestore credentials + user mapping backend private rules tested in emulator.
- [ ] Staging Cloud Run service securely deployed and verified; environment pinned to `heremate`.
- [ ] Expo SDK signInWithCustomToken and persistent login tested on physical Android.
- [ ] Google account linking, Guest upgrade and Recovery Code reviewed separately.
- [ ] Production release authorization: **NOT GIVEN**.

References:
- https://firebase.google.com/docs/auth/admin/create-custom-tokens
- https://firebase.google.com/docs/auth/web/custom-auth
- https://firebase.google.com/docs/auth/web/anonymous-auth
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
