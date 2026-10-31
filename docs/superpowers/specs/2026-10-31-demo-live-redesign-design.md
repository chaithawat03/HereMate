# HereMate — Demo/Live app redesign (Android) — design spec

Date: 2026-10-31 · Status: DRAFT for owner review · Platform: Android (iOS source compatibility preserved, not built)

## 1. Intent (agreed with owner)

- **Purpose:** an Android APK for **demonstrating/presenting HereMate to other people**. It must look polished and show every designed feature. Test data is acceptable.
- **Two modes in one app**, switchable in the UI:
  - **Demo mode** — fully offline, synthetic friends/places, every feature works. Zero risk of backend or login failure during a presentation.
  - **Live mode** — real Firebase login and the existing Staging backend. Features the backend does not support show an explicit "เร็ว ๆ นี้ / Coming soon" state; synthetic data is never shown as real.
- **Visual direction:** Premium Minimal (in the spirit of Apple Find My): full-screen calm map, frosted floating cards, clean typography.
- **Map:** MapLibre + OpenStreetMap vector tiles from OpenFreeMap (no API key, no billing). Google Maps is out of scope.
- **Background sharing in Live mode is IN scope** (owner request 2026-10-31), with an auto-stop of 1, 4 or 8 hours (max 8 h).

Assumptions (owner may correct): the presenter demos on their own Android phone; no Production / Play Store release; no real third-party location data is collected for the demo.

## 2. Out of scope

Chat/messaging · location history · iOS builds · Production deploy · sharing to more than one viewer simultaneously in Live mode (backend keeps its one publisher/viewer pair per owner) · Google Maps · the 26 open security-hardening PRs (#92–#117; separate track) · Live-mode "wave" (Demo only).

## 3. Screens

Tokens: light map base `#EEF1F4`, ink `#1D2228`, secondary `#6B7680`, accent blue `#2F7CF6`, status LIVE `#2FB57C`, STALE `#C9A34A`, OFFLINE/OFF gray, danger `#D64545`; dark theme uses a navy map style with the same semantic colors. Cards are translucent white (or translucent navy in dark) with a hairline border and 20–22 px top radius. Thai and English strings for every label.

1. **Sign-in** — app mark, tagline, *Continue with Google*, *Phone and password* (shown only if the Live phone-login endpoint responds), *Use as guest*, and a divider then **"ลองโหมดสาธิต ไม่ต้องสมัคร"** which enters Demo mode in one tap.
2. **Home / Friends tab** — full-screen map; own position as blue dot; friend pins are round avatars with a status-colored ring (LIVE green, STALE amber, OFFLINE/OFF gray — stale points are labelled with their age, never as live). Floating top-left brand pill, top-right **Demo | Live segmented switch**, right-side recenter and map-style buttons. Bottom sheet (peek/half/full) lists friends with place, age and distance; search when more than 8 friends.
3. **Friend detail card** — name, place, last update, distance; actions *Directions* (opens external maps app), *Alerts* (go to place setup for this friend), *Wave* (Demo only; Live shows Coming soon); consent row "แชร์ตำแหน่งกันทั้งสองฝ่าย / Manage"; destructive *Stop sharing with X*.
4. **Places tab (geofences)** — zone circles on the map; list with zone, subject, radius and state (*Active*, *Waiting for X to approve*); latest alerts; privacy note: the tracked person must approve, no history is kept. *Add* flow: pick friend → drag circle (100–1000 m) → send proposal; the subject sees review → approve/reject.
5. **Me tab** — avatar, name, friend code; switches *Share my location* and *Share when the app is closed* (off by default, opens the background consent sheet); language, theme, mode; **Stop all sharing now**; sign out.
6. **Add friend** — enter friend code; incoming/outgoing requests with accept/decline; two-sided consent toggles.
7. **Permission primer** — explains why before each Android prompt: foreground location, then (only when the user turns on closed-app sharing) "Allow all the time", then notifications.
8. **Background consent sheet** — what is shared, with whom, the ongoing notification, battery note, duration picker **1 h / 4 h / 8 h** (default 1 h), *Start* / *Cancel*.

## 4. Architecture

```
App shell (small in-house nav state: auth gate → tabs [Friends, Places, Me] + bottom sheet; no React Navigation/Reanimated to limit native deps)
   │  uses only
   ▼
HereMateDataSource  (interface, src/data/types.ts)
   ├── DemoDataSource  (src/data/demo/*)   in-memory, deterministic simulator
   └── LiveDataSource  (src/data/live/*)   wraps existing src/auth, friends, location, geofences
ModeController (src/data/ModeController.tsx) – owns the active source and switching
Map (src/map/*) – MapLibre view, styles (light/dark), markers, zone circles
BackgroundSharing (src/location/background/*) – Live-only TaskManager task + controller
```

### 4.1 `HereMateDataSource` (one interface, both modes)

- `session`: `signInGoogle()`, `signInGuest()`, `signInPhone(phone, password)`, `signOut()`, `capabilities` (flags such as `phoneLogin`, `geofences`, `backgroundSharing`, `wave`; screens render *Coming soon* when a flag is false).
- `profile`: `get()`, `update(displayName)`, `friendCode`.
- `friends`: `subscribe(listener)`, `sendRequest(code)`, `respond(id, accept)`, `setConsent(friendId, on)`.
- `location`: `startForeground(viewerId)`, `stop()`, `stopAll()`, `subscribeFriendPoints(listener)` → `{friendId, lat, lng, capturedAt, status}`; `startBackground(viewerId, hours)` / `stopBackground()`.
- `places`: `list()`, `propose(subjectId, circle)`, `review(id)`, `decide(id, approve)`, `subscribeAlerts(listener)`.
- `wave(friendId)`.

Screens never import Firebase, HTTP or simulator code directly.

### 4.2 Demo mode

- 8 synthetic friends with Thai names and locations around central Bangkok (Siam, Silom, Lumphini, Ari, Thonglor…), statuses mixed: LIVE, STALE (e.g. 25 min), OFFLINE, SHARING_OFF.
- LIVE friends move along short pre-recorded polylines on real streets (bundled JSON, no network), updating every 3 s.
- Own location: the device GPS if permission granted, otherwise a fixed Siam point labelled "ตำแหน่งจำลอง / Simulated".
- Places: two preset zones; a scripted friend crosses a zone so an Enter/Exit alert fires within ~30 s of opening the Places tab, plus a *Simulate alert* button.
- Background toggle, wave, phone login and friend requests all work locally with toasts/notifications that say "Demo".
- A persistent small "DEMO" badge on the mode pill; no Demo data is ever written to Firebase.
- Extends existing `src/domain/demo.ts` rather than duplicating it.

### 4.3 Live mode

- Reuses current Staging config (`src/config/firebaseStaging.ts`) and Cloud Run `heremate-m2-location-staging`.
- On entering Live mode, capability probe (short-timeout calls) decides `phoneLogin` and `geofences`; failures → Coming soon, never fake data.
- Foreground sharing and friend points use the existing M2 START/PUBLISH/READ/STOP client code; friend map polling as today.

### 4.4 Mode switching rules

1. Switching always calls `stopAll()` on the current source first (foreground watchers, background task, polling), awaits completion (bounded 5 s), then swaps sources.
2. Switching Demo→Live requires a signed-in Live session; otherwise it goes to the sign-in screen.
3. Selected mode persists across restarts; app opens in the last used mode.
4. Background sharing can only exist in Live mode; Demo's background is simulated in-process only.

### 4.5 Background sharing (Live)

**Client (Android):**
- Add `expo-task-manager`; use `Location.startLocationUpdatesAsync` with a foreground service notification "HereMate กำลังแชร์ตำแหน่งกับ {name}" plus a *Stop* action. Accuracy balanced, distance interval ~25 m, time interval ~30 s.
- Android permissions/config via app config plugin: `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`.
- The task restores the persisted Firebase session (already uses AsyncStorage persistence), refreshes the ID token, and publishes with `mode: "background"`.
- Auto-stop at the chosen deadline (1/4/8 h) enforced both by the task (stops updates when past deadline) and the server (rejects past deadline).
- Stops immediately on: user Stop (app or notification), consent revoked, friend removed, sign-out, mode switch, `stopAll`, or deadline. Revocation is checked on every publish response (server deny → stop task).

**Server (`backend/location`):**
- New explicit field on the publisher grant: `background: { consentedAtMs, deadlineMs }` set only through a new authenticated `startBackground` action by the owner (deadline ≤ now + 8 h, otherwise reject).
- `publish` keeps today's foreground path unchanged. A publish with `appInForeground !== true` is accepted **only** if the grant has an unexpired background block, the relation revision still matches, both consents are still on, and the device lease matches. Point freshness (30 s) is unchanged.
- Grants are still short-lived (`GRANT_MS` 60 s); while background is active, each accepted publish renews the grant up to `deadlineMs` (never beyond). No publish for 2 minutes → grant lapses and friends see the point become STALE.
- `stop`/revocation clears the background block atomically with the grant.
- One publisher/viewer pair per owner is unchanged.
- Deploy to the existing Staging Cloud Run via `m2-staging-cloudrun.yml` **only after owner approval** (the workflow is currently paused).

## 5. Error handling

- Network/backend failure in Live: banner "เชื่อมต่อไม่ได้ / Can't connect. Retry"; map keeps last points marked STALE with age; never re-labels as live.
- Permission denied: primer explains and links to Android settings; app stays usable without sharing.
- Background task killed by OEM battery saver: next app open detects missing updates and shows "แชร์เบื้องหลังหยุดไปเมื่อ HH:MM" with a guide to disable battery optimisation.
- Map tiles unavailable: plain styled background with pins still visible. Tiles are not bundled, so Demo needs internet only for map imagery; offline, every Demo feature still works on the plain background.

## 6. Testing

- Unit (node test runner, existing style `tests/*.test.mjs`): Demo simulator determinism; ModeController always stops before swapping; Live never renders demo data; capability flags drive Coming soon; background deadline clamp (≤ 8 h) and auto-stop.
- Backend (`backend/location-runtime/*.test.mjs` emulator style): background publish accepted only with valid block; rejected after deadline, after consent off, after stop, with wrong lease; grant renewal never exceeds deadline; foreground path unchanged (existing tests stay green).
- CI: existing `pr-ci.yml` (requires re-enabling the paused workflow — owner approval).
- Device acceptance (owner, NOT VERIFIED until done): Demo walkthrough of all screens; Live login → friend consent → foreground share → background share with screen off for 10+ min → auto-stop → Stop from notification.

## 7. Delivery

Feature branch → PR(s) with CI green → merge → APK via `android-m2-native-staging-apk.yml` (owner-triggered, currently paused) → upload to the owner's private Drive folder `HereMate` → owner installs. Before any re-enabling of paused workflows or Cloud Run deploy, ask the owner. Report PASS / BLOCKED / NOT VERIFIED with evidence.

## 8. Risks

- MapLibre RN compatibility with Expo SDK 57 / RN 0.86 — verify first in the plan (spike); fallback: `react-native-maps` with an OSM `UrlTile` layer.
- Background reliability varies by OEM (Samsung, Anbernic); cannot be proven in CI.
- Unmerged security PRs mean Live mode is a Staging test system, not suitable for real-world tracking of people.
- OpenFreeMap is a free community service without an SLA.
