# M0.5.3 Anonymous Guest Staging — approved limited dependency exception

Owner instruction on 2026-10-21: proceed to **physical Android Guest Login testing without further delay**; accept current *Staging Guest-only* inherited Expo dependency risks rather than making them a blocker. This approval is **NOT** authorization to expose Phone/Password, Google account linking, profile/friends data, real GPS or Production.

## Actual dependency audit and remediation
- Initial Guest dependency graph: 19 High-affected dependency records, zero Critical. Root High advisories included `@grpc/grpc-js` in addition to the inherited `braces` and `node-forge`.
- Patched `@grpc/grpc-js` to **1.13.6** via reproducible npm override; owner rebuilt and pushed lockfile, and GitHub CI confirmed `npm ci` and Android/iOS exports.
- After patch: **15 High-affected dependency records**, **0 Critical**; the remaining High root advisories are **`GHSA-vfj7-8cjw-p6xm` for `braces`** and **`GHSA-86w9-cpqp-85rv` for `node-forge`**. Counts describe affected package records, not independent vulnerabilities.
- Legacy M0.1 `security/staging-exceptions.json` remains frozen for synthetic Demo data. Its original guard and test remain in place.
- The new `security/guest-staging-exception.json` records **owner-accepted trial scope**, hashes of exact source/config/lock/rules/release files, allowed GHSA IDs, expiry **2026-11-20**, Staging-only build flag and no Production profile. New Critical/High advisories outside its two entries, hash changes or expired approvals **fail CI/build**.
- `scripts/check-staging-audit.mjs` routes a Guest-staging build to the separately verified Guest policy, otherwise the unchanged M0.1 synthetic snapshot. Neither gate globally disables audit. `tests/security-guest-staging.test.mjs` covers expiry, changed sources, unexpected High/Critical, unsafe build profile and original M0.1 manifest independence.

## Guest trial constraints
- Use only the explicit `android-guest-staging` internal APK profile on Project `heremate` via EAS. Original `android-preview` Demo profile remains in `eas.json`.
- Anonymous Auth is **opt-in by button**, not automatic. Firebase Console has Anonymous and Google providers enabled, but this Guest trial implements only Anonymous.
- Firestore `(default)` in `asia-southeast1` has **deny-all client Rules** confirmed by owner screenshot and actual offline Firebase Emulator tests. No Firestore/RTDB/GPS access in Guest code.
- Firebase Anonymous Auth creates a real *anonymous UID* in the staging project; do not use identifiable personal details. Signing out may permanently lose access to the previous anonymous UID until secure account linking exists.
- A Metro Hermes bundle PASS **does not guarantee** native login/persistence until physical Z Fold7 verification.
- GitHub Actions staging build and existing private Google Drive upload remain subject to their existing WIF / OAuth state; if OAuth delivery expires, retrieve the artifact from the verified EAS build instead of reintroducing custom-domain/OAuth branding as a prerequisite.
- Owner should test Guest login, UID persistence after force-close/reopen, logout and Fold/Unfold UI. Stop and report errors; address issues that appear without broadening scope to real GPS or Production.

Any future Phone+Password, real friend data or location sharing requires separate rules/privacy/security decisions. Production release remains forbidden.
