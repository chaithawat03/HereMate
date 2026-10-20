# M0.1 Time-limited Staging Security Exception

Approved by repository owner on **2026-10-20** after an earlier explicit rejection. The later approval supersedes the prior rejection for **M0.1 synthetic-data Staging only**, not for Production.

## Explicitly permitted unresolved HIGH advisories
- braces — GHSA-vfj7-8cjw-p6xm
- node-forge — GHSA-86w9-cpqp-85rv

Expiry: **2026-11-20 23:59:59 UTC**, tracked in [issue #5](https://github.com/chaithawat03/HereMate/issues/5). Reassess as upstream advisories or fixed versions change; remove exception after verified remediation.

## Mandatory controls
- Run real npm audit against locked production dependencies, do **not** skip or silence audit.
- Only allow affected transitive paths rooted in **exactly** the two approved GHSA package identities. Any new/unrecognized HIGH or any CRITICAL fails.
- Verify this is *staging* Expo configuration, no Production EAS build profile, and **exactly the approved M0.1 App/source/config/lockfile Git blob hashes**. Changing the app or its dependencies requires a new security review.
- Keep evidence visible in GitHub Action Job Summary: affected records and GHSA IDs; passing here means **EXCEPTION ACCEPTED**, not vulnerability fixed or clean.
- No Github Actions deployment permissions or secret access in PR CI.
- Do not use this exception for Auth, personal data, real GPS, production build, Production deploy, or new functionality beyond pinned M0.1 source.
- Physical Android APK build and private My Drive OAuth distribution remain separately gated by EAS identity/signing and staging environment setup.
