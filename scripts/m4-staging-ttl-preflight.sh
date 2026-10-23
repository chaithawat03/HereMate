#!/usr/bin/env bash
# Read-only: no TTL creation, Deploy, secrets, or user GPS.
set -euo pipefail
[[ "$M4_GCP_PROJECT" == "heremate" &&
   "$M4_GCP_REGION" == "asia-southeast1" ]] || {
  echo "M4_TTL_PREFLIGHT_BLOCKED: wrong Staging project/region" >&2
  exit 1
}
command -v gcloud >/dev/null && command -v node >/dev/null || exit 1
snapshot="$(mktemp)"
trap 'rm -f "$snapshot"' EXIT
gcloud firestore fields ttls list \
  --project=heremate --database='(default)' --format=json > "$snapshot"
node scripts/m4-staging-ttl-verify.mjs "$snapshot"
