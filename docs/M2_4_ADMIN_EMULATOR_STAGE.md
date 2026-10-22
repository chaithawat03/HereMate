# M2.4A — Isolated Admin runtime and real Firestore emulator (review-only)

Related: [approved M2 #34](https://github.com/chaithawat03/HereMate/issues/34), [M2.4 runbook](M2_4_RC_INTEGRATION_AND_ACCEPTANCE.md), [M3/M4 CR #38](https://github.com/chaithawat03/HereMate/issues/38).

## Scope
- A separate private `backend/location-runtime` Node package pins `firebase-admin@14.5.0` outside the Expo/mobile dependency tree. No secrets, credential JSON, container image, cloud deployment, service URL or EAS activation.
- A dormant Node HTTP edge bounds request bytes, rejects query parameters, passes exact Bearer/JSON payloads into the previously reviewed M2.1 server-authoritative domain, emits generic errors/no-store headers, and never logs location/identities/tokens.
- `main.mjs` only starts via explicit execution and requires ALL: `K_SERVICE=heremate-m2-location-staging`, `GOOGLE_CLOUD_PROJECT=heremate`, `HEREMATE_M2_ENABLE_SERVER=true`, valid `PORT`, no emulator and no key-file override. Google Cloud ADC is intended to use the future least-privilege Cloud Run service identity. The `verifyIdToken(token,true)` path remains in M2.1 service.
- Real Firestore Emulator tests use the actual Firebase Admin Firestore SDK and actual Firestore transactions, with fake identities, fake token verifier and synthetic GPS. Test SDK connects ONLY when `FIRESTORE_EMULATOR_HOST` is set; never touch live Firebase. A demo-project database is presented through an explicitly staging-typed test adapter to exercise the existing M2.1 storage contract, NOT to attest the live project binding.
- Existing Rules Emulator tests additionally deny direct mobile client reads/writes on all three server-only private location collections.

## CI / deployment boundaries
This stage is **code + local emulator integration, NOT production-ready Cloud Run**. PR CI installs the server SDK isolated using npm with `--package-lock=false` for a non-release test harness; a reviewed reproducible lockfile, dependency advisory scan, true Firebase Auth Admin token revocation tests, staging IAM, budget/TTL, ingress/auth model, deployed negative tests and HTTPS invocation hardening are still blocking before ANY rollout. Do not mistake fake verifier integration tests for real Auth integration.

Cloud Run IAM does not natively treat a Firebase user ID token as its service-invoker credential; the team must separately review the edge's authenticated invocation design and App Check/abuse threat model. **Never deploy a publicly invokable service from this PR by default.**

## Next steps
1. Review PR CI, including true Admin/Firestore transactions and explicit direct-client denials.
2. Resolve the Cloud Run invoker / gateway architecture, Firebase Auth token verification and actual Staging service IAM.
3. Add reproducible server lockfile, image and audited deploy IaC; stage for owner security/cost review.
4. Only then mount the Android panels in a reviewed Staging-only PR and prepare ONE signed, SHA-verified M2 RC for Z Fold7 + RG406V. No interim owner APK request.

All M3 background, iOS cross-platform and M4 geofencing/history requests remain **proposal-only** in #38.

## M2.4A additional Auth Emulator gate
- A separate `auth-emulator.test.mjs` test calls the **actual** Firebase Admin `verifyIdToken(idToken,true)`, with an anonymous Auth Emulator ID token. It checks valid claims and rejection after disabling and revoking the synthetic account. This validates integration with emulator identity, **NOT Google's production token-signature trust**.
- The entire job requires `GCLOUD_PROJECT=demo-heremate-m053`, `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, and empty `GOOGLE_APPLICATION_CREDENTIALS`. The real Cloud Run runtime explicitly rejects both emulator variables. No Firebase real project calls from tests.

## Cloud Run invoker decision pending
The existing mobile M2.4 client sends a **Firebase Auth ID token**, which does *not* meet the Google IAM `roles/run.invoker` OIDC-token requirement for private Cloud Run invocation. A security review must choose and document **one**:
1. An explicitly owner-approved, publicly invokable **Staging-only** HTTPS Cloud Run endpoint that independently validates Firebase ID tokens using Admin SDK on every request, with request ceilings, abuse controls, minimized logs, careful per-recipient authorization, TTL, and budget alarms. Public *invocation* is not public access to location data; security depends on application-level authentication and authorization.
2. A controlled gateway/proxy that itself authenticates client Firebase tokens, limits abuse and invokes private Cloud Run using its own workload identity. Evaluate gateway operational complexity and cost before making it an M2 release requirement.

Do **not** mark `roles/run.invoker` as satisfied by a Firebase user token, open access implicitly, disable token validation, or create/deploy resources under this PR. Region, least privilege, IAM and cost are still owner-reviewed release blockers.

## Isolated runtime dependency audit (CI)
- PR CI generates a **temporary** dependency lock using the pinned direct Admin SDK version and runs `npm audit --omit=dev --audit-level=high` on the isolated backend package. No security exception for the Expo/Guest dependency tree applies to this new location service.
- A generated CI lockfile **is not a committed/reviewed release lockfile**. Production/Staging deployment remains blocked until an exact committed backend lockfile is reviewed and runtime image is built with `npm ci`, not a transient `npm install`.
- An npm registry/audit outage is a CI failure requiring investigation/retry, not permission to skip the security gate.
