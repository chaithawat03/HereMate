# M2.4E — Read-only pre-deployment / post-deployment Staging gate

Status: **CODE ONLY; NO DEPLOY / NO REAL GPS / NO APK**. M2 approved issue #34, owner infrastructure decision #43 remains OPEN, M3/M4 CR #38 remains separate.

After explicit approval of the **billable** Cloud Run deployment and actual deployment of service `heremate-m2-location-staging` into GCP project `heremate`, operators can run the narrow negative smoke test:

```bash
HEREMATE_M2_PROJECT=heremate HEREMATE_M2_SMOKE_APPROVED=true \
  node scripts/m2-4-readonly-cloudrun-smoke.mjs \
  https://heremate-m2-location-staging-REPLACE_WITH_ACTUAL.run.app/
```

The placeholder is NOT a live service URL. It must be replaced with the exact reviewed HTTPS Cloud Run URL. The tool pins the service-name hostname to `.run.app`, rejects other domains, routes and query parameters, sends **no real Firebase ID tokens**, never uses Cloud credentials and **never invokes Start, Stop or Publish**. Only seven unauthorized read/validation probes are sent. They verify the public HTTP surface rejects malformed/missing/forged authorization, disallowed method, media type, oversized request and query injection, and has strict no-store/CORS error response headers. It prints only PASS flags, never tokens, bodies, coordinates or raw Firebase responses. All calls are bounded with no retries.

This test **cannot** prove a private Cloud Run IAM architecture's correct behavior or that real authorized sharing works; it expects the direct public-invocation/app-authenticated design and will fail closed if a private IAM gateway is chosen. It will **not** prove billing caps or DDoS resistance and may incur low, nonzero Cloud Run request cost once used against a deployed service.

**Mandatory next gates:** owner explicitly approves #43's project, region, billing/abuse risk, network invocation A versus gateway B, dedicated IAM and TTL on all four server-only collections; review deployed endpoint and complete real two-test-identity positive/negative START→PUBLISH→READ→STOP and consent/revocation, then only Android Staging M2 mounting and **one** SHA-pinned owner RC on Z Fold7 and RG406V. M2.4E is not an owner-device testing request.
