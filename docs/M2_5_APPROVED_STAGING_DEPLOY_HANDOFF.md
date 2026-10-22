# M2.5 — Approved Staging Cloud Run Deployment Handoff

**Owner-approved on 2026-10-22:** GCP/Firebase project `heremate`, region `asia-southeast1`, public HTTPS invocation with mandatory verified Firebase ID token/transactional friendship+BOTH-consent authorization per request, dedicated least-privilege IAM, four Firestore TTL policies, and measured cost controls. **Not approved:** Production, iOS release, M3/M4. See [issue #43](https://github.com/chaithawat03/HereMate/issues/43).

## Execution capability / prerequisites

GitHub repository operations are connected, but **there is no connected authenticated GCP resource-management tool / gcloud CLI / configured Firebase plugin available to this assistant**. Owner authorization does not itself provision cloud credentials. As of this handoff, no Cloud Run, IAM, TTL, budget or Artifact Registry state has been verified in the actual GCP project and nothing was deployed.

A GCP administrator must configure and verify, through **Google Cloud Console/Cloud Shell using their own project access**, before the manual GitHub workflow can run:
- Project `heremate` billing enabled; actual budget notifications/alerts inspected, with realistic variable request-cost risk accepted. Alerts and Cloud Run `--max=1` **do not guarantee a hard spending cap**. Review ingress risk: public invocation can incur costs even for invalid Firebase tokens.
- **Three new dedicated** service accounts, never the existing `heremate-drive-ci`: `heremate-m2-runtime@` (project `roles/datastore.user`, `roles/firebaseauth.viewer` for `verifyIdToken(...,true)`), `heremate-m2-build@` (Artifact Registry writer and Cloud Logging writer plus any scoped source-read needed for build), and `heremate-m2-deploy@` (Cloud Run Admin for the approved service, Cloud Build Builds Editor, Artifact Registry read where necessary, and `roles/iam.serviceAccountUser` **on the runtime AND Cloud Build SAs individually**). Do not grant Owner/Editor/Datastore Owner to any of these identities. Review exact roles before granting; use IAM Conditions or scoped service resources where supported.
- Create a **dedicated M2 WIF provider** `projects/976775896533/locations/global/workloadIdentityPools/heremate-m2-staging/providers/github-m2-staging` (not the shared Drive provider), with an attribute condition restricting repository `chaithawat03/HereMate`, ref `refs/heads/main`, and exact workflow ref `chaithawat03/HereMate/.github/workflows/m2-staging-cloudrun.yml@refs/heads/main`. Review mapping, condition and per-SA Workload Identity User grant; never use JSON keys.
- Create dedicated `asia-southeast1` Artifact Registry **Docker** repository `heremate-m2-staging`. Enable the required APIs under the approved GCP project. Avoid changing other services.
- Enable Firestore `expireAt` TTL on `private_location_grants`, `private_latest_locations`, `private_location_rate_limits`, and `private_location_publishers`, **and wait for ACTIVE state** (Firestore deletes asynchronously; backend independently enforces read-time expiry). The one-time GCP admin may use:
```bash
for group in private_location_grants private_latest_locations private_location_rate_limits private_location_publishers; do
  gcloud firestore fields ttls update expireAt \
    --collection-group="$group" --database='(default)' \
    --enable-ttl --project=heremate
done
gcloud firestore fields ttls list --project=heremate --database='(default)'
```
- The read-only preflight also requires permission to inspect project IAM, both runtime/build SA IAM policies, Firestore TTL, billing status, and Artifact Registry. Grant scoped read-only metadata permissions or conduct this verification with a separate approved reader. The deploy identity needs `roles/iam.serviceAccountUser` on **both** runtime and build SAs for `gcloud run deploy` and `gcloud builds submit --service-account`. Never grant these permissions project-wide.
- Set GitHub **repository-level variables** (the flags used in job-level `if:` checks must not be environment-only) and environment variables as appropriate `M2_STAGING_DEPLOY_ENABLED=true`, `M2_STAGING_BUDGET_REVIEWED=true`, `M2_STAGING_WIF_TRUST_REVIEWED=true`, `M2_STAGING_WIF_PROVIDER=projects/976775896533/locations/global/workloadIdentityPools/heremate-m2-staging/providers/github-m2-staging`, `M2_STAGING_DEPLOY_SERVICE_ACCOUNT=heremate-m2-deploy@heremate.iam.gserviceaccount.com` **only after evidence verifies the checks**. Protect GitHub environment `m2-staging-deploy` with required reviewers, branch restriction to main; merely naming the environment in YAML does not configure reviewers. The direct GitHub connector cannot configure these secrets/vars or GCP IAM.

## Manual-only execution

Workflow: `.github/workflows/m2-staging-cloudrun.yml` via GitHub Actions **Run workflow**, on `main`, with `confirm_target=heremate/asia-southeast1/M2-Staging`. Run `preflight` first, inspect actual access and all four ACTIVE TTL policies; only then run `deploy` with the same exact target and protected environment approval. Unset GitHub vars cause the job to SKIP by design.

Deployment uses isolated Dockerfile and committed lockfile through `backend/location-runtime/cloudbuild.yaml`, separate Cloud Build SA, SHA-tagged image, `--no-invoker-iam-check` on named M2 Cloud Run service, one service-level max instance, zero min instances, 4 concurrency, 1 CPU, 512Mi, 10s request timeout, no attached service-account JSON, exact `GOOGLE_CLOUD_PROJECT=heremate` and enabled runtime. Public **network invocation** never authorizes GPS data; every API request must pass Firebase ID token and server-side friend/consent checks.

After deployment the job runs **only** the seven read-only negative HTTP smoke checks `scripts/m2-4-readonly-cloudrun-smoke.mjs`; if smoke fails, the script attempts to re-enable the IAM invoker check (fails closed). This does **not** prove full cloud security, scale/cost limit, or real positive authenticated GPS sharing. Inspect Cloud Run default request logs for accidental user IDs and configure logging exclusions/retention with privacy review (Cloud Run emits request logs automatically). No live tokens or GPS are placed into build logs.

## Still mandatory before owner-device milestone

Complete real **deployed** two-account Staging START→PUBLISH→READ→STOP, stranger denials, both-consent OFF and revocation, token disabled/revoked, expiry, foreground-only, Firestore direct-client deny, throttling, cost/log reviews. Then separate reviewed Android-only activation of currently unmounted M2 panels and one SHA-256-verified EAS APK sent to private Drive. Expo Free Android quota had been exhausted until **2026-11-01**. Do not produce interim APK or test on the Galaxy Z Fold7 / Anbernic RG406V until the full RC is ready.

## Operational limits

No repository PR CI test actually executes this workflow or changes GCP. **All workflow executions are explicit, protected main-branch dispatches.** A successful deploy is *Staging-backend verification only*, not M2 release acceptance. The workflow is not authorized to deploy Production, touch other regions, use `heremate-drive-ci`, or enable M3/M4.
