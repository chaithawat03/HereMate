# M0.5.3 Guest Authentication — dependency security review (2026-10-21)

**Review status: BLOCKED, no exception granted. Draft PR #18 must NOT merge or trigger EAS builds.**

## Actual PR CI evidence

After owner's lockfile commit `9ca409f`, [GitHub Actions #39558892673](https://github.com/chaithawat03/HereMate/actions/runs/39558892673) verified `foundation` PASS, Firestore Emulator PASS, native Android/iOS Metro export PASS, TypeScript PASS, tests PASS. The intentional M0.1 lock/scope gate blocked with `STAGING AUDIT BLOCKED: M0.1 approved source changed: App.tsx`.

A separate **read-only** diagnostic was added without changing the blocking security test. [GitHub Actions #39559277305](https://github.com/chaithawat03/HereMate/actions/runs/39559277305) reports:

- npm production dependency audit: **critical 0, high 19 affected package records, moderate 7**. These are package records/propagation, NOT 19 independent root advisories.
- Direct advisory IDs: `GHSA-86w9-cpqp-85rv` (`node-forge`), `GHSA-vfj7-8cjw-p6xm` (`braces`), `GHSA-m9gg-hp2v-232j` (`@grpc/grpc-js`), `GHSA-f596-whhp-79r4` (`@grpc/grpc-js`, categorized low in upstream but may propagate through npm high package counts).
- Lockfile currently has `@grpc/grpc-js@1.9.16`, transitively required by `@firebase/firestore@4.18.0` as `~1.9.0`. Both grpc advisories are fixed in version **1.13.6** or **1.14.5** per upstream: https://github.com/advisories/GHSA-m9gg-hp2v-232j and https://github.com/advisories/GHSA-f596-whhp-79r4. A version override to a patched grpc version would be outside Firestore's declared dependency range and **must pass runtime/Metro and regression tests; do NOT directly edit lockfile or declare it fixed without tests**.
- Legacy M0.1 exception in `security/staging-exceptions.json` is limited to *synthetic-data-only*; expires 2026-11-20. This exception **does not authorize** real Firebase Anonymous Auth users, and its frozen hashes correctly block modifications in the Guest candidate. The inherited `braces` and `node-forge` findings must be remediated or undergo a new explicitly reviewed, scope- and time-limited decision for **Anonymous Guest only**, not Phone/Password or location sharing.

## Remediation preference
1. On the candidate branch, first test whether a **compatible patched version** of `@grpc/grpc-js` can be installed using npm's overrides/relock, without `--force` and without changing production/native packages unexpectedly. Re-run npm CI, strict TypeScript, Android+iOS Metro exports and offline Firestore Emulator. Use `npm audit --omit=dev --json` to confirm the grpc advisories actually disappeared.
2. For inherited Metro signing/CLI advisories, prefer patched Expo-compatible releases when available. Do not `npm audit fix --force` or bypass existing policy globally.
3. Any *remaining* advisories require **separately documented risk acceptance** with owner decision, expiration, exact advisory IDs, affected source snapshot/config and strict feature boundary: `staging` + user-initiated Firebase Anonymous Guest, no phone/password data, no real GPS, no Firestore/RTDB reads, no Production.
4. Implement new security policy verification in a separate reviewed PR **without weakening the existing synthetic-only M0.1 checks**. Both foundation and mobile gates must independently prevent unapproved scope changes. Do not replace `verifyM01Snapshot` with an unconstrained allowlist.
5. Test runtime sign-in and persistence on Android Z Fold7 only after approved staging-only builds.

**No change to Firebase live Security Rules or IAM, and no Production release.**
