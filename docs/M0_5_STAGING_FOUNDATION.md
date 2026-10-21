# HereMate M0.5 — Backend Staging Foundation

Parent: https://github.com/chaithawat03/HereMate/issues/12

## Product-first scope rule
The owner explicitly requires that optional supporting systems never become artificial prerequisites that block the primary product goal. The prior case was over-optimizing private Google Drive Auto Delivery, which led to unnecessary custom-domain/OAuth branding work for a Native Mobile App. For HereMate, finish the minimum needed to make secure Android-first login, Friends, and consent-controlled Live GPS work. Keep OAuth publishing polish, domains, complex observability, and iOS physical-device distribution as separate work unless genuinely blocking.

## Status (21 October 2026)
- M0.4: verified GitHub main -> Expo Android internal APK -> owner Google Drive -> SHA-256 read-back. Run: https://github.com/chaithawat03/HereMate/actions/runs/39532447682
- Android app remains a synthetic-data UI, no Firebase Auth, Firestore, RTDB, Cloud Run backend or real GPS is integrated.
- Existing Google Cloud project heremate (project number 976775896533) hosts WIF, Secret Manager and private Drive OAuth. These control-plane resources must be preserved.
- Firebase registration and billing are NOT VERIFIED for this project.
- Existing Android staging dependency advisory exception is NOT PATCHED and expires 2026-11-20. No Production app release is approved.
- Long-lived Google Drive OAuth remains optional work. A daily read-only health job exists; it does not prolong Google's External/Testing seven-day refresh token lifetime.

## M0.5.1 Inventory — run from Cloud Shell without mutations

    cd ~/HereMate
    git pull --ff-only origin main
    bash scripts/m0-5-inventory.sh

This script refuses any project other than heremate / 976775896533. It only reads project identity, the billingEnabled flag, enabled service APIs, the known WIF provider, the existence of the dedicated service account and Secret Manager secret (without reading payload). It does not change the selected gcloud project, enable APIs, create files, modify IAM or deploy.

An enabled Firebase API is NOT proof that the GCP project is attached to Firebase. A billingEnabled flag is NOT proof a budget alert is configured. Do not share billing account IDs.

Owner must separately check:
1. Firebase Console: Is project heremate registered as a Firebase project? Report YES, NO, or UNKNOWN only.
2. GCP Billing: Is billing enabled, and is a project budget alert configured?
3. Choose backend staging target. Option A: reuse existing heremate with strict staging-only rules for minimal setup. Option B: create a new isolated Firebase staging project if isolation is required. Do not create another project merely because of naming aesthetics. Production must never share mutable staging resources.

## M0.5.2 — planned backend design, NOT provisioned
- Firebase Authentication for identities, with security-focused Cloud Run custom Phone + Password backend only when login requirements are approved.
- Firestore for Users, permanent friendships and explicit sharing consent.
- Realtime Database for ephemeral location, presence, one GPS publisher per account, server-controlled lease/epoch and authorized friend feeds.
- Cloud Run as authoritative authorization boundary: no raw unverified GPS feed readable outside a friendship ACL. No location history in V1.
- Design data locations based on supported services and user latency; choose and approve regions before provisioning.
- Add Firebase emulator / rules / data isolation tests and API authentication tests in PR CI with synthetic fixtures and no credentials.
- Avoid new Google Maps Routes API/billing setup until a real route feature needs it.
- Android is hero; keep iOS TypeScript compatible; iOS physical install/background GPS remains deferred.

## Gate before enabling backend services
Owner approves: exact staging project, Firebase registration intent, project billing + monthly ceiling and alerts, region, and backend Security Baseline. All infrastructure writes then occur by reviewed PR/deployment with explicit staging-only guards.

M0.5.1 acceptance is inventory evidence and staging target decision. This is NOT acceptance of Firebase provisioning, login, GPS, or Production.
