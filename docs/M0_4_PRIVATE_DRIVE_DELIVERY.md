# M0.4 — Private Google Drive Android Staging Delivery

Status: **CODE PREPARED / OWNER OAUTH SETUP REQUIRED**. Zero live Google Drive upload has been verified.

## Fixed destinations and permissions
- Personal existing Google Drive folder: https://drive.google.com/drive/folders/1Q0zgRbKdt9l6ZeEU4KILSf_1vUjQ2gmo
- It is owned by the user's personal Gmail and **Restricted** (confirmed with Drive connector).
- Scope MUST be **only** `https://www.googleapis.com/auth/drive.file`; avoid full Drive access and service-account file ownership.
- Important: **Existing manually created Drive folders are NOT automatically authorized to newly created drive.file OAuth apps**. The user must explicitly grant that exact folder to the OAuth app with a supported Google Picker or equivalent app-mediated file selection. OAuth consent or an ordinary Drive sharing link alone does not authorize the existing folder. If Google API returns 403 or 404 on folder metadata, STOP. Don't silently broaden the OAuth scope.

## Release pipeline
1. Reviewed GitHub main push that changes app files (or manual workflow_dispatch) triggers Android EAS Build, using existing Expo app and Expo-managed Android keystore.
2. Verified finished internal Android APK, EAS build ID and source SHA generate a manifest uploaded to GitHub Actions.
3. Only if repository variable `STAGING_DRIVE_ENABLED=true`, separate **staging-drive** GitHub Environment job starts. No Google identity tokens are available to pull_request jobs.
4. GitHub OIDC exchanges to a **staging Google Cloud Workload Identity Federation** service account. The service account can read **only** Secret Manager secret `heremate-staging-drive-oauth` (no Google Drive IAM role, no JSON key). Use WIF provider attribute restrictions for exact repository and main branch.
5. Secret Manager has JSON object **only** `client_id`, `client_secret`, `refresh_token`. These are from the owner's Google OAuth app authorized for drive.file scope, not from the ChatGPT Google Drive connector.
6. Validate OAuth token scope **exactly** drive.file, Drive OAuth account matches `DRIVE_EXPECTED_OWNER_EMAIL`, folder ID is the known HereMate folder, owner matches, canAddChildren=true, and folder is Restricted.
7. Download HTTPS EAS APK with streaming size cap and ZIP magic check. Calculate local SHA-256 and MD5.
8. Upload Android APK to the owner-authenticated private Drive folder using resumable API; use deterministic name keyed by EAS Build ID.
9. Verify file metadata (parent, size, MD5, own SHA256 app property), then **download the Drive file back** and compare SHA-256 and size.
10. Upload deterministic build-manifest JSON, repeat metadata and read-back SHA-256 verification. Refuse preexisting same-name files with conflicting checksums; safe reruns reuse verified existing files instead of duplicating them.
11. Attach a non-secret delivery receipt to the GitHub Actions workflow run. Google Drive permissions are NOT modified by workflow.

## Setup gates (owner action; do not paste secrets into chat)

### Google Cloud
- Pick/create an isolated GCP staging project; enable Google Drive API, Secret Manager API, IAM Credentials API and Security Token Service API as applicable.
- Under Google Auth Platform configure a user-consent OAuth application with scope drive.file only. Create suitable OAuth 2.0 client, obtain a refresh token **offline** as the personal folder's owner, and check publishing/testing status (External Testing refresh tokens often expire after 7 days).
- Make the existing folder available to that very OAuth app with Google Picker. This can require a small setup utility/web picker page: simply sharing the folder URL publicly is **not** a substitute.
- Store the credential JSON in Secret Manager secret `heremate-staging-drive-oauth`; keep access to this secret narrow and audit enabled.
- Configure Workload Identity Federation pool/provider restricting GitHub repository `chaithawat03/HereMate` and `refs/heads/main`. Bind a designated service account with `roles/secretmanager.secretAccessor` for **only** this one secret. No service account keys.

### GitHub Settings
Create Environment **staging-drive**, restrict it to `main`, and optionally require a human deployment reviewer. Add Environment Variables:
- `GOOGLE_WIF_PROVIDER` — full projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER path
- `GOOGLE_WIF_SERVICE_ACCOUNT` — dedicated service-account email
- `GCP_PROJECT_ID` — isolated staging GCP project ID
- `DRIVE_FOLDER_ID` — `1Q0zgRbKdt9l6ZeEU4KILSf_1vUjQ2gmo`
- `DRIVE_EXPECTED_OWNER_EMAIL` — email of personal Drive owner (not stored in public source)

Repository variable `STAGING_DRIVE_ENABLED`: **leave unset or false** until OAuth and folder access are tested. The existing `STAGING_EAS_ENABLED` is independent. The `EXPO_TOKEN` stays in Environment `staging-eas` only.

## Safety and acceptance
- The M0.1 staging security exception continues for two named existing High advisories only, expiring 2026-11-20; not Production authorization.
- Manual access and setup must be completed before unattended CI Drive delivery; **do not claim M0.4 PASS just because tests and CI pass**.
- The CI verifier writes a deterministic manifest body so retries remain idempotent. The separate local receipt includes the uploaded manifest's Drive file ID.
- EAS build artifacts are not automatically public. Do not share the private Drive folder as 'Anyone with link'.
- No app-store submission, live GPS, iPhone install, or Production deploy in M0.4.
