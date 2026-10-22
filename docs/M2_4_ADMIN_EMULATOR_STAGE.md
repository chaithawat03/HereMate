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
