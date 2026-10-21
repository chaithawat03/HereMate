# M0.5.3 — Actual Firestore Rules Emulator CI

Owner screenshot (21 Oct 2026) confirms Firestore database `(default)` exists in Firebase project **heremate**. Screenshot shows **no collections**, but does not show database location or the *currently deployed* Security Rules. Neither can be inferred.

## PR scope
- `firebase.json` explicitly loads `firebase/firestore.rules` into **local emulator only**.
- `firebase/rules-tests/` holds separate **exact-version** dependencies `firebase@13.0.0` and `@firebase/rules-unit-testing@6.0.0`. They are installed only within a dedicated GitHub CI emulator job; there is **no change to the root Expo package/lockfile, App.tsx, synthetic-only security exception, EAS build or Production**.
- CI runs **Java 21** and Firebase CLI `firebase-tools@15.34.0`, with `--project demo-heremate-m053` and environment `GCLOUD_PROJECT=demo-heremate-m053`, local emulator at `127.0.0.1:8080`, no cloud credentials, no billing.
- Emulator tests enforce deny-all client read/list/create/update/delete for no-login, Firebase Anonymous Guest, Google and other authenticated users. Backend-only credential/rate-limit documents are pre-seeded **only inside the emulator** by test bypass helper.
- The mobile PR CI job depends on the real `firestore-emulator` job PASS. Do not label static Rules inspection as emulator evidence.
- This is a deny-all baseline. **No client reads of profiles/friendships** permitted yet; those require explicit reviewed Rules and privacy ACL tests for M0.5.4.

## What this test does NOT mean
- **Firestore Rules are NOT DEPLOYED** by this PR; no direct evidence of the live database Rules from the screenshot.
- Firebase Admin SDK bypasses client security rules. Firestore backend IAM, credentials protection, transaction constraints and Cloud Run still require separate acceptance.
- No real Phone+Password login, no live GPS tracking, no actual Android Guest/Google login.
- The existing M0.1 synthetic-only security exception is not safe for real user data. A separate SDK/security review before any real Login or sensitive data collection remains necessary.

## Read-only owner verification
Check the Firestore location directly in Cloud Shell, no mutation:

```bash
gcloud firestore databases describe --project=heremate --database='(default)' --format='yaml(name,locationId,type,concurrencyMode)'
```

Check the Firebase Console **Firestore → Rules** tab. **Do not click Publish** or manually change Rules based only on this document. Report the displayed Rules and the region; production-mode / locked setup is expected, but not proven by the Data-tab screenshot.

Only deploy `firebase/firestore.rules` to the `heremate` staging database after a separate review, emulator PASS and explicit rule-deployment approval, with before/after Rules release readback and a rollback plan.

References:
- https://firebase.google.com/docs/firestore/security/test-rules-emulator
- https://firebase.google.com/docs/firestore/security/get-started
- https://firebase.google.com/docs/firestore/locations
