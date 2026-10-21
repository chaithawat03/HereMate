# M0.4 — Long-lived Google Drive OAuth and health checks

Verified baseline: [GitHub Run #6](https://github.com/chaithawat03/HereMate/actions/runs/39532447682) (2026-10-21) successfully delivered the Android staging APK and build-manifest.json privately with SHA-256 read-back. No Production app rollout.

## Why the existing refresh token will expire
HereMate's owner OAuth client is currently Google Auth Platform External / Testing and requests only https://www.googleapis.com/auth/drive.file (non-sensitive).
Google expires refresh tokens issued for external Testing clients with Drive scopes after seven days. Refreshing access tokens daily **does not extend** that fixed expiry.

## Owner-only publication and rotation procedure
1. In Google Cloud Console -> project heremate -> Google Auth Platform -> Branding, provide accurate application information. For external OAuth apps Google requires an appropriate publicly accessible app homepage and privacy policy on a domain owned and verified by the operator. Do not invent URLs or broaden scopes; the personal-use exception can reduce verification demands but does not bypass Google's Console/policies.
2. In Google Auth Platform -> Audience, change OAuth publishing status from Testing to In production using Publish app, *if Console allows*. Report a disabled button and its stated blocker rather than guessing. OAuth In production is **not** an app Production deploy.
3. After status reads In production, perform a fresh offline+consent Google Picker authorization using the existing HereMate OAuth Client, scope only drive.file, selecting the existing Restricted personal folder 1Q0zgRbKdt9l6ZeEU4KILSf_1vUjQ2gmo. Check picked_file_ids and Drive API GET folder metadata returns HTTP 200 and canAddChildren=true.
4. Exchange the new one-time authorization code for a new refresh token. Do not paste secrets/codes/tokens into chats, GitHub Issues or logs. An old token originally issued under Testing should be replaced; simply publishing OAuth does not prove the old token acquired longer lifetime.
5. Write JSON with exactly client_id, client_secret, refresh_token to a new version of Secret Manager secret heremate-staging-drive-oauth in Google Cloud project heremate, via hidden prompts piped to gcloud stdin. DO NOT disable the old version before validating the new one, or print the secret.
6. On GitHub Actions Staging Android EAS Build (gated), run workflow_dispatch on main with run_mode=preflight. This refreshes the owner's OAuth token and verifies account, restricted folder and write capability in read-only mode using the latest Secret Manager version. It does not build or upload APKs.
7. After verified new-version preflight, optionally disable old Secret Manager versions deliberately. If a new version fails, restore known-good credentials via a *new* secret version from an owner-controlled secure backup; no blind deletion.

## Continuous monitoring
The same workflow has a daily 07:17 UTC (14:17 Asia/Bangkok) scheduled **read-only** preflight job. GitHub schedule execution can be delayed. Job failures are visible in GitHub Actions; email notification requires the owner's GitHub notification settings and is not guaranteed.

Safety invariant: neither schedule nor manual run_mode=preflight can trigger EAS build, APK uploads, or Production. Manual run_mode=build remains behind STAGING_EAS_ENABLED and STAGING_DRIVE_ENABLED.
Refreshing a token daily does not prevent revocation or expiration for other reasons (e.g., 6 months inactivity, user revocation); handle invalid_grant with reauthorization, never broaden Drive permissions.

References:
- https://developers.google.com/identity/protocols/oauth2/#expiration
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance
- https://support.google.com/cloud/answer/15549049

Staging-only upstream dependency security exception remains unpatched and expires 2026-11-20; Production app release not authorized.
