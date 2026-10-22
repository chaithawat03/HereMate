#!/usr/bin/env bash
# M2.5 ONLY: manual, reviewed GitHub main SHA, dedicated GCP identities and
# owner-approved heremate/asia-southeast1 Staging. NO Production or M3/M4.
set -euo pipefail
[[ "${M2_GCP_PROJECT:-}" == "heremate" &&
   "${M2_GCP_REGION:-}" == "asia-southeast1" &&
   "${M2_GCP_APPROVAL_ISSUE:-}" == "43" &&
   "${M2_GCP_DEPLOY_CONFIRMED:-}" == "true" &&
   "${M2_BUDGET_REVIEWED:-}" == "true" &&
   "${M2_WIF_TRUST_REVIEWED:-}" == "true" &&
   "${GITHUB_REPOSITORY:-}" == "chaithawat03/HereMate" &&
   "${GITHUB_REF:-}" == "refs/heads/main" &&
   "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "M2_STAGING_DEPLOY_BLOCKED: target, review, or SHA mismatch" >&2
  exit 1
}
bash scripts/m2-staging-gcp-preflight.sh
image="asia-southeast1-docker.pkg.dev/heremate/heremate-m2-staging/location-runtime:${GITHUB_SHA}"
# Separate Cloud Build identity; never use default or Drive delivery identity.
gcloud builds submit . \
 --project=heremate --region=asia-southeast1 \
 --config=backend/location-runtime/cloudbuild.yaml \
 --service-account='projects/heremate/serviceAccounts/heremate-m2-build@heremate.iam.gserviceaccount.com' \
 --substitutions="_IMAGE=${image}" --quiet
# Limit service-level scaling; budget ALERTS and max instances are NOT hard caps.
gcloud run deploy heremate-m2-location-staging \
 --project=heremate --region=asia-southeast1 --image="$image" \
 --service-account='heremate-m2-runtime@heremate.iam.gserviceaccount.com' \
 --set-env-vars='HEREMATE_M2_ENABLE_SERVER=true,GOOGLE_CLOUD_PROJECT=heremate' \
 --no-invoker-iam-check --ingress=all \
 --min=0 --max=1 --concurrency=4 --cpu=1 --memory=512Mi \
 --cpu-throttling --timeout=10s --port=8080 --quiet
# Public invocation uses *app-level* Firebase ID token checks at EVERY endpoint;
# NEVER pass real Firebase credentials to Cloud Run IAM as invoker tokens.
service_deployed=true
rollback_if_smoke_fails() {
 if [[ "${service_deployed:-}" == "true" ]]; then
   echo "M2_STAGING_DEPLOY_BLOCKED: read-only smoke failed; restoring IAM invoker check" >&2
   gcloud run services update heremate-m2-location-staging \
     --project=heremate --region=asia-southeast1 --invoker-iam-check --quiet || true
 fi
}
trap rollback_if_smoke_fails ERR
url="$(gcloud run services describe heremate-m2-location-staging \
 --project=heremate --region=asia-southeast1 --format='value(status.url)')"
[[ "$url" == https://heremate-m2-location-staging-*.run.app ]] || {
 echo "M2_STAGING_DEPLOY_BLOCKED: unexpected service URL" >&2
 exit 1
}
HEREMATE_M2_PROJECT=heremate HEREMATE_M2_SMOKE_APPROVED=true \
  node scripts/m2-4-readonly-cloudrun-smoke.mjs "$url/"
trap - ERR
printf 'M2 Staging smoke PASSED. Exact reviewed service origin: %s\n' "$url"
printf 'Deployment is NOT full real-user GPS E2E and NOT Android RC-ready.\n'
