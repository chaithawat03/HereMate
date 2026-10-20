# M0.2–M0.3: Android-first CI & EAS staging

## Code and CI
- Native M0.1 app remains synthetic-data-only. No actual GPS, Firebase, login or personal records.
- PR quality gates: npm ci, TypeScript, domain unit tests, Android/iOS Metro JS export smoke, security policy, and EAS release-guard tests.
- The user-approved staging Security Exception is restricted to existing braces and node-forge advisories in the pinned M0.1 source through 2026-11-20. It is not a security patch.
- Staging EAS workflow checks that the merged SHA belongs to a reviewed PR whose foundation and mobile CI checks succeeded. A direct push to main will not build.
- Production deployment is not authorized.

## First-time setup by owner
1. The existing Expo Project is smartyyys-team/heremate. Confirm the immutable Expo Project UUID with authenticated Expo access. Link the existing project, not a duplicate. In a reviewed PR, add expo.extra.eas.projectId to app.json and update/review its pinned security snapshot.
2. Create an Expo token and store it as EXPO_TOKEN in GitHub environment staging-eas. Do not send it in chat or commit it.
3. Set up Android EAS signing credentials (managed keystore) via secure interactive Cloud Shell for the first build; subsequent CI builds can use non-interactive mode.
4. Configure GitHub environment staging-eas, restricted to main; repo variable STAGING_EAS_PROJECT_ID must equal the verified UUID.
5. Enable repository variable STAGING_EAS_ENABLED=true only when Expo UUID, credentials, and required checks are ready. Absent/false means build SKIPPED, not PASS.

## Acceptance evidence
- Reviewed merged SHA and green PR checks.
- EAS status FINISHED with APK artifact URL, Build ID, and staging manifest.
- GitHub Actions manifest alone is not a Google Drive delivery. OAuth upload and SHA-256 verification are M0.4; physical Android installation follows.
- iOS JavaScript bundling is not an iPhone device build. Apple Developer membership remains deferred.
