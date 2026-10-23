# M4.1 — Trusted server-side Geofence consent & transaction (NOT DEPLOYED)

This source-only integration extends the earlier offline M4 geofence policy
with a second-stage **tracked subject's approval** and real Firestore Admin
transactions in a demo emulator. The only permitted region is Staging and
the domain requires project \`heremate\` Firebase ID tokens checked with
\`verifyIdToken(token, true)\`; tests project isolated demo claims for the
domain test only.

- \`propose\`: the circle is proposed by an accepted M1 friend while BOTH
  existing sharing consents are true; one pending/active zone per pair,
  24h pending proposal expiry, no implicit subject acceptance.
- \`review\`: only the tracked subject can see the exact proposed latitude,
  longitude and radius before informed acceptance.
- \`decide\`: subject alone approves or rejects. Both decisions require the
  **exact reviewed proposal creation timestamp** returned by \`review\`;
  an expired/replaced proposal cannot be approved or rejected using an older
  review. Approval also binds the **precise Firestore relationship revision**
  and expires after 7 days.
- \`evaluate\`: only the tracked subject may submit its own transient
  foreground location fix. The server transaction independently checks
  current accepted M1 friendship, both M1 sharing-consent flags, current
  approved zone and matching relationship revision, M2 server-authoritative
  grant + **one active publisher lease owned by subject, viewed by zone owner**.
  Accuracy/age/boundary gates, two stable samples and 5min deduplication
  yield an optional event string **only to the tracked subject**.
  Raw subject GPS never enters stored \`private_geofence_states\` or history.
- \`revoke\`: either owner or tracked subject always deletes zone/state
  even if relationship was removed or consents became OFF.
- Firestore rules keep both private collections inaccessible by any client.
  Admin Emulator tests exercise real transactions, invalid consent,
  stranger, expired grant, re-consent invalidation, revoke, and no coordinates
  in state. This is NOT a deployed Cloud Run endpoint or notification system.

Important outstanding release gates: proper new server HTTP route / WAF / rate
limit, independent Android/iOS geofence UX, no notification delivery yet,
TTL policies for new private docs and store budget review, revocation/rate
limits and OS background lifecycle/permissions. Do not connect a phone GPS
to these modules or claim M4 milestone complete. User requested a SINGLE
consolidated hardware acceptance after all milestones; see Issue #54.
