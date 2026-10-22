# HereMate M2.1 — Server-authoritative location data plane (CODE ONLY)

Owner-directed transition from M1.4 to M2: https://github.com/chaithawat03/HereMate/issues/34
Privacy policy M2.0: https://github.com/chaithawat03/HereMate/pull/35

## Status
This PR adds a **Firebase Admin/Firestore transactional server code contract and an HTTP handler**.
**It does not start a server, deploy Cloud Run, create Firestore collections, add a native client API, amend Firebase Security Rules, or transmit real GPS.**
The deployed Android APK remains M1 local-GPS only. Production and background GPS remain OFF.

## Why Firestore-only first?
The M1 friend ledger and consents live in Firestore. A separate RTDB with direct client writes/reads cannot atomically consult Firestore consent from its own rules. M2.1 therefore uses **one Firestore transaction for every single relationship/grant/point read or write**, and no direct client access. Four records may be transactionally read: `friendRequests/{A}__{B}`, `friendRequests/{B}__{A}`, `private_location_grants/{owner}__{viewer}`, `private_latest_locations/{owner}__{viewer}`. If both directional relationship docs exist, authorization fails closed as ambiguous.

Current Firestore Rules already blanket-deny these new server-only collections to all clients; only a **future dedicated Cloud Run service identity with Firebase Admin SDK** may use them. No rules or indexes deployed in this PR.

## Trusted boundary
1. HTTPS edge receives a POST with a **Firebase client ID token** in Bearer header (not a custom token or UID accepted from the body). Firebase Admin `verifyIdToken(token,true)` verifies signature, expiry, disabled/revoked state; validate project-specific `aud`, `iss`, `uid` and `sub`. Token verifier and Firestore project must both be pinned to `heremate`. All errors are generic and headers set `Cache-Control: no-store`.
2. Sender/receiver UIDs are derived from verified token + strictly validated selected peer UID, no public list. Server re-fetches **both current relationship and grant** inside each transaction, never trusts stale client consent values. Both consent flags and accepted status are mandatory to START, WRITE and READ.
3. A user explicitly starts a **per-recipient** share grant for max 60 seconds. This revokes any prior point for that viewer. Repeated starts are rate limited by durable Firestore counters. The grant and latest point have `expireAt` fields for future Firestore TTL setup.
4. A publisher additionally supplies a fresh accurate location fix and true foreground/permission signals; mobile foreground and OS permission signals are **not independently verifiable by backend** and must be guarded locally (M2.2). Server never uses these flags as a replacement for M1 consents and server-owned grant. Each write requires an active grant bound to the exact Firestore relationship `updatedAt.seconds:nanoseconds` revision. A Consent OFF→ON transition invalidates the old grant and requires a fresh explicit Start; it never resurrects previously shared coordinates. Data is scoped to that viewer only.
5. A viewer calls the read endpoint using their own independently verified token; owner UID from the body is a lookup target, not an authority. Read rechecks grant/consents/friendship and point age before returning only the point + expiry. No history, names or relationship metadata are returned.
6. The owner can STOP for a specific viewer even if friendship was removed; both grant and point are deleted atomically. Subsequent reads deny when STOP, consent change, removal, expiry or offline timeout takes effect. **This does not promise to retract an HTTP response already in flight** at the exact moment of revocation.
7. Persistent per-UID/per-route rate-limiting limits START (6/min), STOP (30/min), PUBLISH (12/min), READ (30/min). Limits are deliberately restrictive until cost and abuse testing. Rate limiter data never contains full UIDs in document IDs.

## Security, data lifecycle and privacy caveats
- Staging only; no service URL, credential material, background tasks, or HTTP listener enabled.
- **Firestore TTL is not immediate deletion**; add TTL policies for `expireAt` in the three server-only collections before deployment, and separately bound retention/delete orphans. Reads ALWAYS deny expired data regardless of when TTL actually deletes it.
- Backend Cloud Run deployment needs reviewed project/IAM identity, Firebase Admin SDK package pinned and audited, Cloud Run ingress and auth threat model, HTTPS/CORS/CSRF policy, request size and timeouts, App Check viability, budget guard, and rollout flag. Current code is an injectable domain/HTTP/adapter API; it is **not yet a production-hardened Cloud Run entrypoint**.
- Client must guarantee foreground-only Start/Stop, visible sharing indicator, notification/access controls and best-effort Stop on background/logout/device permission revoke. Network outage may prevent a Stop call reaching server; short (60-second) server-enforced grant expiry is a fallback, not instant remote revocation.
- More than one accepted reciprocal M1 friend request for the same pair denies sharing (deliberate safer behavior), pending reconciliation.
- Do not log bearer tokens, coordinates, UIDs, error stacks or precise location history, even to crash/error analytics.

## Offline test plan
`node --test tests/m2-1-server-location.test.mjs`:
- server startup project pinning and durable rate-limit requirement
- successful opt-in, publish, recipient read, STOP and deletion
- third-party deny, signed-out/revoked token deny, cross-account spoofing deny
- M1 consent OFF / removed friendship deny after a previously granted session
- GPS freshness, boundaries, accuracy, extraneous fields, foreground/permission flags
- ambiguous reciprocal records deny
- rate limiting in transactional Firestore adapter
- HTTP bearer, method/content type, strict JSON keys, body cap and no sensitive error leakage
- Android EAS config remains OFF for M2.

## Next gated actions (no owner device test now)
M2.2 UI first, then dedicated Cloud Run service/infrastructure deployment only after security and cost review. Obtain owner-only setup when indispensable. Final user acceptance is ONE M2 RC on Z Fold7 and RG406V, as agreed.
