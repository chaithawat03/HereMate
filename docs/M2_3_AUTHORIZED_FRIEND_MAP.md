# M2.3 — Authorized real-friend map projection (dormant, Staging scope only)

Tracking: [M2 #34](https://github.com/chaithawat03/HereMate/issues/34) · CR M3/M4 is a [SEPARATE PROPOSAL #38](https://github.com/chaithawat03/HereMate/issues/38) and is NOT approved.

## Delivery status and boundaries
This work contributes the **pure M2.3 presentation model** (`src/location/m2FriendLocationView.ts`), an **unmounted** React Native `M2FriendLocationPanel`, tests, TH/EN+Light/Dark copy and a correction of the M1 synthetic-map label. These modules do not connect to a Cloud Run URL, start GPS, publish anything, request background permission, store historical locations or read private Firestore position docs.

The live backend in M2.1 remains **not deployed**, so **M2.3 is not complete as an end-to-end feature**, and the current APK has no real friend location map. App.tsx and EAS configs deliberately remain unchanged; Android build, Cloud Run deployment and physical owner acceptance are separate M2.4 gates.

## Security and status semantics
- Future authenticated `transport.read(ownerUid)` MUST invoke the reviewed Cloud Run read endpoint using the *current viewer's Firebase ID token*. Server MUST re-verify friendship, both parties' consent, current short-lived grant and point expiry for EVERY read. An accepted M1 friendship never authorizes public Firestore reads.
- Render pins **only for viewer-participant accepted friends, mutual consent, unique directed relationship, strict payload fields and an unexpired accurate fix**. No locations for strangers, pending/removed friends, duplicate reciprocal records or revoked consent. Every displayed position must pass the 30-second fix age / <=200m accuracy / expiry checks.
- Status `LIVE`: validated, fresh authorized point. `STALE`: a prior verified response has expired; hide its marker and coordinates. `SHARING_OFF`: accepted friend is missing mutual consent (does not make a claim about a currently live backend grant). `UNAVAILABLE`: no fresh confirmed read. **Do not infer OFFLINE from an unavailable response.** M2.1 has no trusted device-presence attestation. An explicit OFFLINE label requires future independently reviewed server evidence; no fake online indicators.
- Position view is a **schematic relative coordinate plot** with north-up / antimeridian handling. It is **NOT Google Maps, Apple Maps, street-level mapping or navigation**. A real map SDK or basemap integration is a separately reviewed improvement, without changing current M2.3 privacy scope.
- Bounded initial fan-out: at most **8** independently authorized friend reads per explicit user refresh. No global friend query, background polling or continuous subscription. Further pagination/scale and mapping choices require budget and performance review.
- Auth UID change, sign-out, app going inactive or unmount clear in-memory location data immediately. Every refresh discards previous coordinates before fetching again, and late responses from an old epoch/identity are ignored. A bounded stale window is used only for status, then old coordinates are removed from memory; never written to disk/logs.
- UI is based on existing TH/EN and Light/Dark tokens. The existing synthetic map and marker list remain explicitly labelled **demo only**, not represented as real live friends.

## Acceptance tests / next steps
1. `node --test tests/m2-3-friend-map-privacy.test.mjs`: viewer-only, consent, status, stale/expiry, payload shape, impossible GPS values, duplicate reciprocal relationships, no direct Firestore subscriptions, antimeridian/north-up projection, staging feature remains off.
2. Foundation/Emulator/Mobile CI all GREEN before merge.
3. M2.4 must wire the **actual reviewed** Admin + Cloud Run service to mobile only after service IAM, consent-revision transactional behavior, revocation, rate/TTL/cost/security tests and owner Staging config. No background GPS, geofencing or history are authorized.
4. Deliver **one consolidated M2 Android Staging RC** for Z Fold7 + RG406V only after real live sharing and read visibility work and all hard gates. No submilestone owner APK/video request.
