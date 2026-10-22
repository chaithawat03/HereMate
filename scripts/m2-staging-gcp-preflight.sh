#!/usr/bin/env bash
# M2.5 GCP preflight. READ-ONLY (no resource creation, IAM update or GPS).
# Execute only under the dedicated authorized deployment workload identity.
set -euo pipefail
[[ "${M2_GCP_PROJECT:-}" == "heremate" &&
   "${M2_GCP_REGION:-}" == "asia-southeast1" &&
   "${M2_GCP_APPROVAL_ISSUE:-}" == "43" &&
   "${M2_BUDGET_REVIEWED:-}" == "true" &&
   "${M2_WIF_TRUST_REVIEWED:-}" == "true" ]] || {
  echo "M2_GCP_PREFLIGHT_BLOCKED: incomplete approved Staging context" >&2
  exit 1
}
command -v gcloud >/dev/null && command -v node >/dev/null || {
  echo "M2_GCP_PREFLIGHT_BLOCKED: gcloud and Node required" >&2
  exit 1
}
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Exact project and dedicated SAs: never reuse heremate-drive-ci.
gcloud projects describe heremate --format='value(projectId)' |
  grep -Fxq 'heremate'
gcloud iam service-accounts describe \
  heremate-m2-runtime@heremate.iam.gserviceaccount.com \
  --project=heremate --format='value(email)' |
  grep -Fxq 'heremate-m2-runtime@heremate.iam.gserviceaccount.com'
gcloud iam service-accounts describe \
  heremate-m2-build@heremate.iam.gserviceaccount.com \
  --project=heremate --format='value(email)' |
  grep -Fxq 'heremate-m2-build@heremate.iam.gserviceaccount.com'
gcloud iam service-accounts describe \
  heremate-m2-deploy@heremate.iam.gserviceaccount.com \
  --project=heremate --format='value(email)' |
  grep -Fxq 'heremate-m2-deploy@heremate.iam.gserviceaccount.com'
gcloud artifacts repositories describe heremate-m2-staging \
  --location=asia-southeast1 --project=heremate \
  --format='value(format)' | grep -Fxq 'DOCKER'
gcloud billing projects describe heremate --format=json > "$tmp/billing.json"
gcloud projects get-iam-policy heremate --format=json > "$tmp/project-policy.json"
gcloud iam service-accounts get-iam-policy \
  heremate-m2-runtime@heremate.iam.gserviceaccount.com \
  --project=heremate --format=json > "$tmp/runtime-policy.json"
gcloud firestore fields ttls list --project=heremate \
  --database='(default)' --format=json > "$tmp/ttl.json"
node scripts/m2-staging-gcp-verify.mjs \
  "$tmp/billing.json" "$tmp/project-policy.json" \
  "$tmp/ttl.json" "$tmp/runtime-policy.json"
