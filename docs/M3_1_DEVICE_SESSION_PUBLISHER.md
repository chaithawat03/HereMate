# M3.1 — One active device publisher using transient session capability

This is **Staging backend source only**. No iPhone signed build, background
location permission, new Cloud Run revision or final APK is created.

The existing M2 owner-wide `private_location_publishers/{ownerUid}` transaction
already prevents multiple START grants, but two phones signed into the *same*
Firebase account could otherwise both publish under an active legacy grant.
M3 introduces three separate `/v2/locations/sessions/*` authenticated routes:

- `start` issues a cryptographically random 256-bit `sessionToken` to the
  authenticated publisher only; the token is never stored in Firestore, only
  purpose-bound SHA-256 digests in existing 60-second TTL grant+publisher docs.
- `publish` requires the active grant and lease plus the same session digest
  and current M1 accepted friendship, bilateral consent and exact current
  relation revision. A legacy v1 publisher is denied for a new M3 lease.
- `stop` requires the active device capability, so a delayed STOP from an
  older device cannot clear the newer same-viewer session. Independently,
  the signed-in owner can always emergency revoke with existing `v1 STOP`,
  even after exhausting the normal STOP quota. A lost app session times out
  after at most 60 seconds.
- No new Firestore collections or TTL configuration, device identifiers,
  GPS history or long-lived background polling.

Source CI includes strict Node HTTP request-schema tests, offline same-account
collision/stale-publisher unit tests and isolated **real Admin Firestore**
transactions in the existing emulator suite. NO Production changes, live
service redeploy or Android/iOS native EAS build in this PR.

Remaining before M3 acceptance: Android/iOS native clients must hold the
session token only in memory, clear it on logout and background, use the v2
endpoints consistently and support the owner's separate emergency revoke.
Background sharing needs distinct opt-in, OS entitlements/permission and a
safe server-side renewal/handoff policy; this 60-second foreground session
does not implement persistent/background tracking. See Issue #54.
