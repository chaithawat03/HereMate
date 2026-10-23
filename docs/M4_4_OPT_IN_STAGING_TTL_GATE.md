# M4.4 — TTL preflight & opt-in combined M2/M4 Staging runtime

**Status 2026-10-23: SOURCE ONLY. M4 NOT DEPLOYED, NOT LIVE, no APK built.**
This is a progression toward the owner-requested one final M0–M4 device
acceptance, not permission to process anyone's location without their consent.

## Default Cloud Run behavior is unchanged

The existing approved Cloud Run service remains
\`heremate-m2-location-staging\`. The new application **source** includes the
M4 domain code in its Docker image, but defaults to M2 routes ONLY.
\`HEREMATE_M4_ENABLE_SERVER\` is **absent** from all current committed Cloud Run
deploy workflows/scripts, so existing approved M2 service and all Android/iOS
build profiles stay unchanged. A separate deploy/revision would be necessary;
none is requested, authorized or performed in this PR.

New \`createStagingRouteHandler\` delegates only exact
\`/v1/geofences/\`-prefixed requests to the M4 Node HTTP handler when the
server is explicitly enabled. The strict M2 HTTP edge remains the fallback
for all other paths. The underlying M4 HTTP layer still validates tokens,
post bodies, request framing, 2KiB request cap and optional domain rate limits.
No new public CORS, no logging of coordinates, no push notifications.

## Required three Firestore TTL policies

New private M4 Admin-only collections use \`expireAt\`:
- \`private_geofence_zones\` — one owner/subject approved circle; max 7d
- \`private_geofence_states\` — ephemeral inside/outside dedup state; max 7d
- \`private_geofence_rate_limits\` — hashed per-account/route counter,
  expires about one day after the active 60-second window

Before any M4 Cloud Run activation, use the **read-only** operator check
from the repository root, only under the authorized existing owner
Staging GCP session:

\`\`\`bash
M4_GCP_PROJECT=heremate M4_GCP_REGION=asia-southeast1 \
  bash scripts/m4-staging-ttl-preflight.sh
\`\`\`

This reads only \`gcloud firestore fields ttls list\` and requires exactly
one matching \`ACTIVE\` \`expireAt\` policy on each M4 collection group.
It refuses missing, CREATING, duplicate or wrong-database policies.
No IAM/TTL/database mutations are present in the script. The three M4 TTL
policies have **not** been verified ACTIVE on live GCP as of this PR;
do not turn on M4 if the check fails. Operators must review and separately
approve any necessary TTL creation/changes and GCP costs.

After genuine ACTIVE TTL verification and cost review, a **separate**
approved deployment could set:
\`HEREMATE_M4_ENABLE_SERVER=true\`,
\`HEREMATE_M4_TTL_REVIEWED=true\`,
\`HEREMATE_M4_BUDGET_REVIEWED=true\`.
These strings are operator approval assertions, NOT a substitute for the
read-only live TTL check. Existing M2 deploy scripts DO NOT pass these flags.

## Outstanding before enabling M4

- Explicit approved Staging rollout, limited abuse/cost guard for unlimited
  authenticated revoke traffic (revoke must remain usable);
- independent device-level opt-in for event notifications and safe recipient
  delivery; server should NOT forward raw GPS event data by default;
- clear UX for consent revocation/unfriend/logout, map/device lifecycle,
  optional background location only with separate user permission;
- signed iOS device build; Android/iOS final physical tests as one owner
  acceptance, no iterative APK distribution;
- optional historical GPS remains OFF pending distinct user decision.

Evidence: local Node HTTP gate tests, M4 Firestore Admin Auth/consent/grant
emulator tests, Firestore Rules emulator, Docker build smoke and strict
Android/iOS TS and Metro exports via PR CI. This is not live acceptance.
