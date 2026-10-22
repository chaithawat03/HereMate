# M2.4 — Cloud Run Staging release authorization gate (NOT approved)

Tracking: M2 #34; PR #42 is code-only. M3/M4 CR #38 is outside M2.

## Verified architecture
- Firebase Auth ID tokens issued to Android users **cannot substitute** for Cloud Run IAM OIDC invoker tokens. For direct mobile calling, Cloud Run's documented end-user pattern is a publicly invokable HTTPS service with a separately verified Firebase ID token and server-side per-user authorization on every request. "Publicly invokable" means unauthenticated network requests can hit the Cloud Run runtime, **not** that they can read GPS data.
- This project's M2 server uses `firebase-admin` `verifyIdToken(token,true)`, project/issuer/audience pins, transactional accepted-friend and BOTH-consent checks, a per-recipient 60s grant, age/accuracy validation, one owner-wide active publisher lease and read-time expiry. The endpoint limits HTTP JSON body size and authenticated request rate, but invalid-token invocation abuse still costs money. Google Cloud Armor / API Gateway and App Check merit explicit cost/security assessment, not assumed magic protection.
- Source Dockerfile uses a reviewed digest-pinned Node 24 image and separate backend `npm ci` lock; Cloud Build YAML below is **build-only**. It does NOT deploy or configure GCP.
- Firestore client rules deny four private backend collections; Admin service account must have only required Firestore access. Cloud Run must use ADC workload identity, no JSON key file.

## OWNER decision required BEFORE ANY billable Staging action
1. Confirm **GCP/Firebase project `heremate`**, Cloud Run **region** (candidate `asia-southeast1` / Singapore, subject to current availability and cost), and that Staging billing, alerts/budget and risk of variable usage are acceptable. Budget alerts are not a hard cost cap.
2. Decide network architecture:
   - **Option A (simpler):** explicitly allow public Cloud Run *invocation only*, with Firebase Auth project-pinned `verifyIdToken(...,true)` for every request, per-user rate limits, restrictive per-friend grants and conservative max instances. Consider unauthenticated traffic cost/abuse. **Not approved by default.**
   - **Option B:** separate trusted gateway validates Firebase tokens and invokes IAM-private Cloud Run via a Google workload identity; additional service and cost. Needs its own review.
3. Confirm a **new dedicated** Cloud Run runtime and deploy identity (never reuse `heremate-drive-ci`), IAM least privilege, secret-free ADC, ingress policy, request-logging redaction and max instances/concurrency/timeouts. Require a reviewer for any deployment environment.
4. Approve TTL configuration for collections `private_location_grants`, `private_latest_locations`, `private_location_rate_limits`, and `private_location_publishers`; TTL deletion is asynchronous, so server read-time expiry remains mandatory.

## NOT-YET-EXECUTED commands (review template only)
After the owner confirms #1–#4, an operator with appropriately scoped GCP authorization may review and adapt:

```bash
# Confirm project + region, cost, service identities, and service account first.
gcloud config set project heremate
gcloud firestore fields ttls update expireAt --collection-group=private_location_grants --enable-ttl --project=heremate
gcloud firestore fields ttls update expireAt --collection-group=private_latest_locations --enable-ttl --project=heremate
gcloud firestore fields ttls update expireAt --collection-group=private_location_rate_limits --enable-ttl --project=heremate
gcloud firestore fields ttls update expireAt --collection-group=private_location_publishers --enable-ttl --project=heremate
# Verify TTL field status independently; it can take time to activate.
```

To build the isolated image (requires approved Artifact Registry image and Cloud Build permissions), use the review-only `backend/location-runtime/cloudbuild.yaml` with `_IMAGE` set to an approved Staging image path. There is deliberately **no** `gcloud run deploy` command, IAM grant or automatic GitHub deployment job in this PR.

## Blockers prior to actual M2 Android RC
- Approve network invocation mode and anti-abuse cost safeguards.
- Authorize and verify dedicated Staging service identity, project, region, TTL, logging, config and measured budget.
- Create and deploy reviewed Cloud Run service explicitly; pin resulting HTTPS URL, verify real Firebase user ID-token acceptance and negative cross-account/removed/consent-OFF cases.
- Activate Android-only foreground share/map UI under separately reviewed Staging flag **after** secure service and app checks; do not alter iOS/Production or background permissions.
- SHA-pinned build + private Drive manifest + **ONE** Z Fold7/RG406V acceptance; no intermediate user APK test.

**No GCP actions or real GPS writes were performed by this planning document.**
