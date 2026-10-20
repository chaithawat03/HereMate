# M0 — HereMate Android-first mobile foundation

Status: **PLANNED / implementation in progress**. Owner approved architecture V2.0 and staging-only automation. Production is **not authorized**.

## Verified existing accounts

- GitHub repository: `chaithawat03/HereMate`, initial main bootstrap completed.
- Expo project shown as **HereMate**; connected to the repository. The actual immutable **EAS project ID** still needs to be read from Expo Project Settings before app configuration.
- Personal Google Drive folder **HereMate** exists. It was shared as "anyone with link — viewer" at verification time; the owner must change it to **Restricted**. **Public sharing grants no OAuth write access.**
- The app's Drive OAuth identity has not yet been authorized. Do not use a raw folder ID as proof of write permission.

## M0 work packages

### M0.0 — Bootstrap

- Establish repository and CI-on-PR base contract.
- Capture Android hero, iOS-ready and staging-only release decisions.
- No privileged tokens on PR jobs.
- No app code, build or deploy has been verified yet.

### M0.1 — Expo native shell

- Create Expo + React Native + TypeScript starter from a supported Expo SDK.
- Bind immutable EAS project ID to the correct Expo account (don't infer it from display name or GitHub link).
- Keep Android and iOS native config compatible.
- Provide one-map UI with **synthetic** friends and locations; do not collect actual GPS before explicit UI validation.

### M0.2 — Product CI gates

- Pin and commit the package lockfile.
- Add `npm ci`, lint, typecheck, unit tests, config validation, and build smoke (where supported).
- Security and privacy tests for future GPS/Friendship permissions are mandatory in their feature milestones.
- Required checks and review policy before merge; CI fail-closed.

### M0.3 — EAS preview builds

- Android: `android-preview` profile yields signed internal installable APK.
- iOS: `ios-simulator` profile checks native simulator build only; this is **not a physical iPhone IPA**.
- First signing credential setup may need attended secure initialization.
- Expo account token must be kept in secure GitHub secrets; never commit or paste into code.
- Builds are not enabled until SDK, project ID and credentials are confirmed.

### M0.4 — Personal My Drive OAuth

- Use `drive.file` with a personal user OAuth identity, no broad Drive scope and no service-account file ownership.
- **Existing folder nuance:** an existing folder, even if shared by URL, is not necessarily accessible with a newly authorized `drive.file` app. Explicit user selection via Google Picker, or an app-created destination, must grant app access; validate upload to the exact destination under OAuth before enabling unattended workflow.
- External OAuth app in Testing may issue seven-day refresh tokens. Complete an appropriate consent publishing setup before relying on unattended CI.
- Store refresh token and OAuth client secrets in Secret Manager; use GitHub OIDC / Google Workload Identity Federation for short-lived secret access.
- Upload built APK plus checksum, EAS build ID, source commit, and build manifest; verify file metadata and hash.
- Keep destination folder **Restricted**. Do not auto-post public APK links.

### M0.5 — Staging GCP/Firebase setup

- New HereMate staging project, distinct from Production and all prior projects.
- Configure billing/budget notifications, least-privilege IAM and WIF for GitHub `main` and staging environment.
- No Cloud Run, Auth or Realtime Database deployment until feature milestone needs it.

### M0.6–M0.7 — End-to-end acceptance

Plan → implement/test → review → PR/CI → merge → EAS build → verify → OAuth Drive upload → physical Android device installation.
- Verify merged commit and every downstream artifact; a successful EAS trigger alone is not a successful release.
- **Android device:** owner downloads APK and validates actual installation. Distinguish automated checks from human-reported acceptance.
- **iOS:** static/unit/compatibility and simulator build only while unpaid Apple Developer setup is deferred.
- iOS on-device background tracking remains **NOT VERIFIED**, never mark PASS until real iPhone validation.

## Environment and approval policy

- PR checks must have `contents: read`, no cloud access, and no secrets.
- Staging EAS builds publish after reviewed and required-checked merge only.
- No production app store delivery, production resources or production rollout without **separate explicit owner approval**.
- Note: GitHub repository currently does not have Auto Merge enabled; the owner must configure auto-merge/branch-protection policy before autonomous merges are declared operational.
