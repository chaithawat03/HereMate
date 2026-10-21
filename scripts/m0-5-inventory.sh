#!/usr/bin/env bash
# M0.5.1 — read-only inventory of existing HereMate GCP control project.
# Never creates/enables/deploys resources or reads secret payloads.
set -euo pipefail
PROJECT_ID="${1:-heremate}"
EXPECTED_PROJECT_ID="heremate"
EXPECTED_PROJECT_NUMBER="976775896533"
if [[ "$PROJECT_ID" != "$EXPECTED_PROJECT_ID" ]]; then
  echo "BLOCKED: M0.5 inventory is allowlisted for heremate only" >&2
  exit 2
fi
if ! command -v gcloud >/dev/null 2>&1; then
  echo "BLOCKED: gcloud CLI missing" >&2
  exit 2
fi
number="$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")"
if [[ "$number" != "$EXPECTED_PROJECT_NUMBER" ]]; then
  echo "BLOCKED: project number mismatch" >&2
  exit 2
fi
echo "=== HereMate M0.5.1 READ-ONLY GCP INVENTORY ==="
echo "PROJECT_ID=$PROJECT_ID"
echo "PROJECT_NUMBER_VERIFIED=true"
if billing="$(gcloud billing projects describe "$PROJECT_ID" --format="value(billingEnabled)" 2>/dev/null)"; then
  case "${billing,,}" in
    true) echo "BILLING_ENABLED=true";;
    false) echo "BILLING_ENABLED=false";;
    *) echo "BILLING_ENABLED=UNKNOWN";;
  esac
else
  echo "BILLING_ENABLED=UNKNOWN (billing access unavailable)"
fi
enabled="$(gcloud services list --enabled --project="$PROJECT_ID" --format="value(config.name)")" || {
  echo "BLOCKED: cannot list enabled APIs" >&2
  exit 3
}
for api in firebase.googleapis.com firebasehosting.googleapis.com \
    firestore.googleapis.com firebasedatabase.googleapis.com \
    identitytoolkit.googleapis.com run.googleapis.com \
    secretmanager.googleapis.com drive.googleapis.com \
    billingbudgets.googleapis.com; do
  if grep -Fxq "$api" <<< "$enabled"; then
    echo "API_${api}=ENABLED"
  else
    echo "API_${api}=NOT_ENABLED"
  fi
done
if provider="$(gcloud iam workload-identity-pools providers describe github \
    --project="$PROJECT_ID" --location=global --workload-identity-pool=heremate-gh \
    --format="value(state)" 2>/dev/null)"; then
  echo "GITHUB_WIF_PROVIDER_STATE=${provider:-UNKNOWN}"
else
  echo "GITHUB_WIF_PROVIDER_STATE=UNKNOWN"
fi
if gcloud iam service-accounts describe \
    "heremate-drive-ci@heremate.iam.gserviceaccount.com" --project="$PROJECT_ID" \
    --format="value(email)" >/dev/null 2>&1; then
  echo "DRIVE_CI_SERVICE_ACCOUNT=EXISTS"
else
  echo "DRIVE_CI_SERVICE_ACCOUNT=UNKNOWN"
fi
if gcloud secrets describe heremate-staging-drive-oauth --project="$PROJECT_ID" \
    --format="value(name)" >/dev/null 2>&1; then
  echo "DRIVE_OAUTH_SECRET=EXISTS (payload not read)"
else
  echo "DRIVE_OAUTH_SECRET=UNKNOWN"
fi
echo "FIREBASE_PROJECT_LINK=UNVERIFIED (confirm in Firebase Console)"
echo "FIRESTORE_DATABASE=UNVERIFIED"
echo "REALTIME_DATABASE=UNVERIFIED"
echo "CLOUD_RUN_SERVICES=UNVERIFIED"
echo "BUDGET_ALERTS=UNVERIFIED (confirm in Billing Console)"
echo "STAGING_PROJECT_TARGET=DECISION_REQUIRED"
echo "PRODUCTION_DEPLOYMENT=NOT_AUTHORIZED"
echo "READ_ONLY_INVENTORY_COMPLETE=true"
