# HereMate M2.2 — Foreground-only location-sharing UI, not enabled

Tracking: https://github.com/chaithawat03/HereMate/issues/34
Backend review: https://github.com/chaithawat03/HereMate/pull/36

## Scope and non-release status
The M2.2 `src/location/m2ForegroundSession.ts` coordinator and `src/location/M2SharingPanel.tsx` React Native panel are **not imported or rendered from App.tsx**. There is NO Cloud Run endpoint, GPS API transport implementation, new `EXPO_PUBLIC_ENABLE_M2_SHARING` flag, EAS production setting, Firestore Rules change, or network-enabled location publication in this release. All actual GPS coordinates in the existing M1 Android app remain device-only.

Once M2.1 Cloud Run Admin integration, security, permission and cost review, and dual-device QA are complete, a separate reviewed PR will supply the authenticated transport and explicitly mount the panel in **Staging only**.

## M2.2 behavior under a future authenticated transport
1. App loads the real accepted-friend ledger, requiring **mutual M1 consent and an explicitly selected recipient**; no global sharing toggle. The user must press Start manually. Default state OFF on each new app session; preferences do not store sharing state.
2. Android OS foreground permission is required. Permission dialogs may temporarily background the app; this fail-closed implementation cancels pending Start and requires retry if the app stops being active. No background permission/task is requested.
3. Start receives a server-authoritative per-recipient grant with expiry at most **60 seconds**. Only after grant and an active foreground watcher exist does the UI show Sharing ON; actual network publish is throttled to at most one fix per 10 seconds and requires current GPS <=30 seconds old, accuracy <=200m, valid coordinates.
4. Upon explicit Stop, app background/inactive, sign-out/auth identity change, consent state change, watcher error or grant expiry, the local watcher stops immediately, coordinates are cleared from UI state and an asynchronous server Stop is attempted. Stop waits for any in-flight Start or Publish before remote revocation to prevent late responses from resurrecting a revoked location.
5. If server Stop is not acknowledged, show **Remote stop unconfirmed** and block new sharing until Retry Stop confirms. Server's short grant TTL is a safety fallback, **not an immediate remote revocation promise**; remote reads must independently enforce current consent/friendship on every request.
6. No auto-renewal, background GPS, analytics coordinates, sharing on app startup or cross-account persistence. Translations for TH and EN, visible live-status indicator and theme tokens are part of the unmounted UI.

## Limitations / gates
- M2.1 needs a deployed Cloud Run runtime with verified Firebase Admin tokens, Firestore Admin transaction behavior against isolated emulator, TTL setup, IAM and hardening before wiring transport. No app can claim live sharing based on a local boolean.
- The client can observe foreground/permission at the device but the server **cannot independently prove foreground**. Those signals are additional client safeguards, never a substitute for backend authorization. Revoked permission during a running session must be handled with reliable native/watch errors or a permission-state check on each fix before Staging enablement.
- A best-effort Stop cannot retract a response already in transit. Server TTL must enforce read-time expiry regardless of Firestore's asynchronous cleanup.
- The panel currently shows an explicit unavailable state if disabled, and has no runtime transport until later reviewed integration.
- Fresh friend/consent state for a selected recipient is obtained by explicit Refresh in the UI; backend permission is checked on every publish/read to avoid relying on stale screen data.
- Only after the full M2 backend and map flows are complete will the owner receive ONE named M2 Android Release Candidate for testing on Galaxy Z Fold7 + Anbernic RG406V, per established policy.
