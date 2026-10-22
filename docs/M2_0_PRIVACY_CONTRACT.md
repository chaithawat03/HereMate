# M2.0 — Privacy contract (offline only, not enabled)

Tracking: https://github.com/chaithawat03/HereMate/issues/34
Deferred M1 acceptance checks: https://github.com/chaithawat03/HereMate/issues/33

## Scope now
The `src/location/m2SharingPolicy.ts` file is a **pure, deterministic decision policy**, not a realtime backend or GPS publisher. Its associated offline tests ensure fail-closed defaults. No Android app import, no build flag, no changes to Firestore Security Rules, Expo permissions, Google Login or EAS/Drive deployment. This PR alone cannot transmit any location.

## Authorization model for later M2.1–M2.3
- Each incoming request supplies a **verified Firebase Authentication UID** for the actor, and the backend reads the **current** accepted M1 friend relationship from Firestore. Do not rely on a client-provided copy or stale cache.
- Both relationship participants must have independently enabled their future-sharing consent. These booleans alone **do not start GPS publishing**. The owner also needs a separate explicit short-lived, server-authoritative sharing grant (max 5 min, renewed only by deliberate foreground activity); initial state OFF.
- The owner explicitly starts *foreground* GPS sharing with OS permission and an on-screen indicator. The mobile client stops the watcher and asks the server to revoke on Stop, sign-out, app background or permission loss. The backend cannot independently prove the app is foreground, so device state is an additional local control, **not** a replacement for server consent/grant checks.
- The server authorizes every write and every read against current Firestore relationship + both consents + owner's non-expired grant. On Stop or friendship/consent revocation, invalidate grant and revoke reads immediately, even if previously stored coordinates have not been physically deleted. Do not wait for point TTL to expire.
- Validate incoming point lat/lng [-90,90]/[-180,180], finite accuracy <=200m, fix not older than 30 seconds or more than 5 seconds in future. A successful decision only means *eligible for later guarded handling*, not automatic network send.
- Bound point freshness/retention. Prefer only latest position, never history or logs with coordinates; backend response to revoked recipients must be denied even if stale rows still exist. Server clocks and retention cleanup are required before rollout.
- Existing Firestore Rules deny arbitrary locations. Realtime Database rules do **not** have Cloud Firestore `get()` lookups, and their rules are a separate security language. M2 backend should use a reviewed server-side Firebase ID token + Firestore relationship authorizer; deny direct client RTDB reads/writes. A server-admin mechanism alone is insufficient unless each caller is checked on every operation.

## Release gates
- M2.1 implementation and emulator tests for stranger reads, forged identities, revoked friends, revoked consent, over-age coordinates, offline/replay, TTL and no backend read on account switch.
- Review a staging-only Cloud Run/RTDB or equally secure Firestore architecture, instance availability, service identity and cost/abuse controls before deployment.
- M2.2 new user-facing opt-in and stop UI, with unmistakable visible sharing state, clear multi-language copy and explicit foreground permission grant.
- M2.4 one consolidated Android hardware acceptance; no intermediate sub-milestone APK testing request.
- **No production release, background location, or service deployment is authorized by this policy PR.**

References:
- https://firebase.google.com/docs/database/security/rules-conditions
- https://firebase.google.com/docs/rules/basics
