# HereMate Demo/Live Android Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Android app root ("HereMate v2") with a Premium-Minimal full-screen MapLibre UI, an in-app Demo/Live mode switch, and Live background location sharing (1/4/8 h auto-stop).

**Architecture:** A new root `HereMateApp.tsx`, selected at bundle time by `EXPO_PUBLIC_ENABLE_HEREMATE_V2=true` (old roots untouched). Screens talk only to one `HereMateDataSource` interface; `DemoDataSource` is an in-memory simulator and `LiveDataSource` wraps the existing `src/auth`, `src/friends`, `src/profile`, `src/location`, `src/geofences` modules. A `ModeController` owns the active source and always runs `stopAll()` before swapping. Background sharing adds an Expo TaskManager task on the client and an explicit, deadline-bound `background` block on the server grant.

**Tech Stack:** Expo SDK 57, React Native 0.86.2, TypeScript, `@maplibre/maplibre-react-native` + OpenFreeMap tiles, `expo-location` + `expo-task-manager`, Firebase JS SDK 13, Node 22 `node --test` (type-stripped `.ts` imports, as existing tests do), Cloud Run backend in `backend/`.

**Spec:** `docs/superpowers/specs/2026-10-31-demo-live-redesign-design.md`

## Global Constraints

- Android only for builds; keep iOS source compiling (`npm run typecheck` green). Never deploy Production.
- Existing roots `App.tsx`, `M2StagingApp.tsx`, `M3IOSStagingApp.tsx` and their tests stay unchanged and green.
- No new native UI deps beyond `@maplibre/maplibre-react-native` and `expo-task-manager` (no React Navigation, no Reanimated, no blur): navigation is a small in-house tab/stack state; "frosted" cards are translucent fills.
- Map style source: `https://tiles.openfreemap.org/styles/positron` (light) and a dark variant derived from it at build time in `src/map/styles.ts`; no API keys.
- Tokens (exact): ink `#1D2228`, secondary `#6B7680`, map base light `#EEF1F4`, accent `#2F7CF6`, LIVE `#2FB57C`, STALE `#C9A34A`, OFFLINE/OFF `#A0AAB4`, danger `#D64545`; card radius 22 (sheet top) / 12 (tiles).
- Every user-visible string exists in both `th` and `en`.
- Stale data is never labelled live: a friend point is LIVE only when age ≤ 30 000 ms (`MAX_VISIBLE_FIX_AGE_MS`); otherwise STALE with its age shown.
- Demo data never reaches Firebase or any network call except map tiles.
- Background sharing: off by default, Live only, durations exactly `[1, 4, 8]` hours, default 1 h, server max `8 * 3_600_000` ms.
- Backend: foreground publish path behaviour unchanged; one publisher/viewer pair per owner unchanged; `GRANT_MS` stays 60 000.
- Never commit secrets, tokens, keystores or real coordinates. Commit trailer per session reminder.
- Paused workflows (`pr-ci.yml`, APK, Cloud Run) are only dispatched/re-enabled after explicit owner approval. Report PASS / BLOCKED / NOT VERIFIED.

## Review Focus

1. Mode switch while Live background sharing is running → background task stopped and server grant stopped before Demo appears (Task 4 test `switch_stops_background_first`).
2. App reopened after the background deadline passed → shows "stopped at HH:MM", task is not re-registered (Task 9 test `expired_deadline_not_resumed`).
3. Network lost mid Live session → friend pins turn STALE with age, never fake LIVE, and a "Can't connect" banner shows (Task 5 test `network_loss_marks_stale`).
4. "Allow all the time" denied → background switch reverts off with explanation; foreground sharing continues (Task 9 test `background_permission_denied_keeps_foreground`).
5. Zero friends and very long Thai names → empty-state invitation and single-line ellipsis, no layout break (Task 7 test `empty_and_long_name_rendering`).

---

## File Structure

```
HereMateApp.tsx                         new root: providers + shell
index.ts                                (modify) select v2 root by env flag
app.json                                (modify) plugins + Android permissions
src/data/types.ts                       HereMateDataSource + domain types
src/data/modeController.ts              pure switching logic
src/data/ModeProvider.tsx               React context around modeController
src/data/demo/demoWorld.ts              friends, routes, zones (Bangkok)
src/data/demo/demoDataSource.ts         simulator implementing the interface
src/data/live/capabilities.ts           probe phone/geofence/background routes
src/data/live/liveDataSource.ts         wraps existing modules
src/map/styles.ts  src/map/status.ts  src/map/HereMap.tsx  src/map/FriendMarker.tsx  src/map/ZoneCircle.tsx
src/app/strings.ts  src/app/theme.ts  src/app/nav.ts
src/app/components/{GlassCard,BottomSheet,ModeSwitch,TabBar,ComingSoon}.tsx
src/app/screens/{SignIn,Home,FriendDetail,Places,Me,AddFriend,PermissionPrimer,BackgroundConsent}.tsx
src/location/background/backgroundPolicy.ts     pure deadline/stop rules
src/location/background/backgroundTask.ts       TaskManager task + controller
backend/location/location-service.mjs   (modify) startBackground + background publish
backend/location/http.mjs               (modify) route /v1/locations/background/start
.github/workflows/android-v2-preview-apk.yml    dispatch-only branch preview APK
.github/workflows/pr-ci.yml             (modify) add new test files
tests/v2-*.test.mjs                     one file per task below
```

---

### Task 1: v2 root, MapLibre spike and preview build pipeline

**Files:**
- Create: `HereMateApp.tsx` (temporary: full-screen `HereMap` only), `src/map/styles.ts`, `src/map/HereMap.tsx`, `.github/workflows/android-v2-preview-apk.yml`
- Modify: `index.ts`, `app.json`, `package.json`, `package-lock.json`
- Test: `tests/v2-foundation.test.mjs`

**Interfaces:**
- Produces: `mapStyleUrl(theme: 'light'|'dark'): string` and `HereMap` props `{theme; center: {lat:number;lng:number}; children?: ReactNode; onPressMap?: () => void}`; env flag `EXPO_PUBLIC_ENABLE_HEREMATE_V2`.

- [ ] **Step 1: Write failing test** `tests/v2-foundation.test.mjs` asserting: `index.ts` routes to `HereMateApp` only when `Platform.OS==='android'` and `EXPO_PUBLIC_ENABLE_HEREMATE_V2==='true'` and otherwise keeps the existing ternary; `app.json` android permissions include `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`; plugins include `@maplibre/maplibre-react-native` and `expo-location` with `isAndroidBackgroundLocationEnabled: true`; `mapStyleUrl('light')` starts with `https://tiles.openfreemap.org/styles/`; the new workflow has only `workflow_dispatch`, `permissions: contents: read`, a `confirm_target` equal to `heremate/android-v2-preview`, no `secrets.` references, sets `EXPO_PUBLIC_ENABLE_HEREMATE_V2: 'true'` plus the existing M2 staging env flags, and uploads one APK artifact with SHA-256 manifest (retention 7 days).
- [ ] **Step 2: Run** `node --test tests/v2-foundation.test.mjs` → FAIL.
- [ ] **Step 3: Install** `npx expo install @maplibre/maplibre-react-native expo-task-manager`; implement `index.ts` flag, `app.json` changes, `styles.ts`, `HereMap.tsx` (MapLibre `MapView` + `Camera`, attribution visible as OSM requires), workflow copied from `android-m2-native-staging-apk.yml` with the branch guard removed, dispatch input changed, Drive/issue-comment parts removed.
- [ ] **Step 4: Run** test → PASS; `npm run typecheck` → no errors; `npx expo prebuild --platform android --no-install --clean` in a scratch copy → exits 0 and generated `AndroidManifest.xml` contains the five permissions.
- [ ] **Step 5: Commit** `feat(v2): HereMate v2 root, MapLibre map and preview APK workflow`.
- [ ] **Step 6: Spike gate (owner approval needed to dispatch).** Dispatch `android-v2-preview-apk.yml` on the branch. PASS = job SUCCESS and APK artifact present. If Gradle fails on MapLibre with RN 0.86 and one pinned-version retry does not fix it, stop and report BLOCKED to the owner with the log excerpt and the fallback option (`react-native-maps`, which needs a tile source decision); do not continue to Task 6. Record the outcome in the PR description.

### Task 2: Domain types and data source interface

**Files:**
- Create: `src/data/types.ts`
- Test: `tests/v2-types.test.mjs`

**Interfaces:**
- Produces (exact):
```ts
export type Mode='demo'|'live';
export type FriendStatus='LIVE'|'STALE'|'OFFLINE'|'SHARING_OFF';
export type LatLng=Readonly<{lat:number;lng:number}>;
export type Friend=Readonly<{id:string;name:string;initials:string;consentMine:boolean;consentTheirs:boolean}>;
export type FriendPoint=Readonly<{friendId:string;at:LatLng;capturedAtMs:number;status:FriendStatus;placeLabel?:string}>;
export type FriendRequestView=Readonly<{id:string;direction:'incoming'|'outgoing';name:string}>;
export type Zone=Readonly<{id:string;subjectId:string;label:string;center:LatLng;radiusM:number;state:'pending'|'active'}>;
export type ZoneAlert=Readonly<{zoneId:string;friendId:string;kind:'enter'|'exit';atMs:number}>;
export type Capabilities=Readonly<{phoneLogin:boolean;geofences:boolean;backgroundSharing:boolean;wave:boolean}>;
export type BackgroundHours=1|4|8;
export type SharingState=Readonly<{foregroundWith:string|null;background:null|{withId:string;deadlineMs:number}}>;
export type Unsub=()=>void;
export interface HereMateDataSource{
  readonly mode:Mode;
  capabilities():Promise<Capabilities>;
  session:{current():{uid:string;displayName:string}|null;signInGoogle():Promise<void>;signInGuest():Promise<void>;signInPhone(phone:string,password:string):Promise<void>;signOut():Promise<void>;};
  profile:{get():Promise<{displayName:string;friendCode:string}>;rename(name:string):Promise<void>;};
  friends:{subscribe(fn:(friends:Friend[],requests:FriendRequestView[])=>void):Unsub;sendRequest(code:string):Promise<void>;respond(requestId:string,accept:boolean):Promise<void>;setConsent(friendId:string,on:boolean):Promise<void>;remove(friendId:string):Promise<void>;};
  location:{subscribeFriendPoints(fn:(points:FriendPoint[],connected:boolean)=>void):Unsub;subscribeSharing(fn:(s:SharingState)=>void):Unsub;startForeground(friendId:string):Promise<void>;startBackground(friendId:string,hours:BackgroundHours):Promise<void>;stopBackground():Promise<void>;stop():Promise<void>;stopAll():Promise<void>;myPosition():Promise<LatLng|null>;};
  places:{subscribe(fn:(zones:Zone[],alerts:ZoneAlert[])=>void):Unsub;propose(subjectId:string,center:LatLng,radiusM:number,label:string):Promise<void>;decide(zoneId:string,approve:boolean):Promise<void>;remove(zoneId:string):Promise<void>;};
  wave(friendId:string):Promise<void>;
}
export const BACKGROUND_HOURS:readonly BackgroundHours[]=[1,4,8];
export const LIVE_MAX_AGE_MS=30_000;
export function statusForAge(ageMs:number,sharing:boolean,online:boolean):FriendStatus;
```
- [ ] **Step 1: Failing test** for `statusForAge`: `(0,true,true)→'LIVE'`, `(30_000,true,true)→'LIVE'`, `(30_001,true,true)→'STALE'`, `(5,false,true)→'SHARING_OFF'`, `(5,true,false)→'OFFLINE'`; `BACKGROUND_HOURS` deep-equals `[1,4,8]`.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement. **Step 4: Run** → PASS. **Step 5: Commit** `feat(v2): data source interface and domain types`.

### Task 3: Demo world and DemoDataSource

**Files:**
- Create: `src/data/demo/demoWorld.ts`, `src/data/demo/demoDataSource.ts`
- Modify: `src/domain/demo.ts` only to export reusable name/status helpers if needed (keep existing exports and `tests/mobile-demo.test.mjs` green)
- Test: `tests/v2-demo-source.test.mjs`

**Interfaces:**
- Consumes: Task 2 types.
- Produces: `createDemoDataSource(ports:{now:()=>number;setInterval:(fn:()=>void,ms:number)=>unknown;clearInterval:(h:unknown)=>void;myGps?:()=>Promise<LatLng|null>}):HereMateDataSource` with `mode==='demo'`; `DEMO_TICK_MS=3000`; `DEMO_FALLBACK_POSITION={lat:13.7462,lng:100.5347}` (Siam).

World content (exact counts): 8 friends — มิ้น, ต้น, แบม, ปอนด์, ฟ้า, นัท, เจ, ข้าวหอม — 4 LIVE moving on bundled polylines (Siam, Silom, Lumphini, Ari), 2 STALE (ages 25 min, 2 h), 1 OFFLINE, 1 SHARING_OFF; 2 zones: "บ้าน" (active, subject แบม, 200 m) and "มหาวิทยาลัย" (pending, subject มิ้น, 300 m); แบม's route crosses "บ้าน" so an `enter` alert fires on tick 10 (30 s).

- [ ] **Step 1: Failing tests:** 8 friends with the exact status mix; after 1 tick LIVE points move and `capturedAtMs===now()`; STALE points keep old `capturedAtMs`; on tick 10 a `ZoneAlert{zoneId:'home',friendId:'bam',kind:'enter'}` is emitted once (not again on tick 11); `capabilities()` all `true`; `startBackground('mint',4)` sets `deadlineMs=now+4*3_600_000`; `stopAll()` clears the interval handle and sharing state; `signInPhone` resolves for any non-empty input; `globalThis.fetch` replaced by a throwing stub is never called through the whole test; `wave` resolves.
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement (pure TS, interval via ports). **Step 4: Run** → PASS, and `node --test tests/mobile-demo.test.mjs` → PASS. **Step 5: Commit** `feat(v2): offline demo world and data source`.

### Task 4: ModeController and ModeProvider

**Files:**
- Create: `src/data/modeController.ts`, `src/data/ModeProvider.tsx`
- Test: `tests/v2-mode-controller.test.mjs`

**Interfaces:**
- Consumes: Task 2 `HereMateDataSource`, `Mode`.
- Produces: `createModeController(ports:{makeDemo:()=>HereMateDataSource;makeLive:()=>HereMateDataSource;load:()=>Promise<Mode|null>;save:(m:Mode)=>Promise<void>;timeoutMs?:number}):{active():HereMateDataSource;init():Promise<Mode>;switchTo(m:Mode):Promise<{mode:Mode;needsSignIn:boolean;stopTimedOut:boolean}>;subscribe(fn:(s:HereMateDataSource)=>void):Unsub}`; `MODE_STOP_TIMEOUT_MS=5000`. `ModeProvider` exposes `useHereMate():{source:HereMateDataSource;mode:Mode;switchTo:(m:Mode)=>Promise<...>}`; storage key `heremate.v2.mode` in AsyncStorage.

- [ ] **Step 1: Failing tests:** `init()` returns saved mode, default `'demo'`; `switch_stops_background_first` — fake live source with background active: `switchTo('demo')` calls `stopAll()` on live and resolves only after it, then subscribers receive the demo source; `stopAll` hanging > 5000 ms → still swaps with `stopTimedOut:true`; `switchTo('live')` with `session.current()===null` → `needsSignIn:true` and mode `'live'`; switching to the current mode is a no-op (no `stopAll`).
- [ ] **Step 2–4:** fail → implement → pass. **Step 5: Commit** `feat(v2): mode controller with stop-before-swap`.

### Task 5: LiveDataSource and capability probe

**Files:**
- Create: `src/data/live/capabilities.ts`, `src/data/live/liveDataSource.ts`
- Test: `tests/v2-live-source.test.mjs`

**Interfaces:**
- Consumes: Task 2 types; existing `getStagingGuestAuth`, `startGuestSession`, `stopGuestSession` (`src/auth/firebaseGuest.ts`), `runGoogleIdentityFlow`/`continueStagingGoogleWithNativeToken`, `loadOwnProfile`/`createOwnProfile`/`renameOwnProfile`, `listOwnRequests`/`sendFriendRequest`/`actOnRequest`/`setOwnFriendConsent`/`ownInviteCode`, `createForegroundSharingController`, `createM2StagingTransport`, `createAndroidFriendMapPoller`, `friendMapStates`, `createM4StagingTransport`.
- Produces: `probeCapabilities(ports:{fetchImpl:typeof fetch;baseUrl:string;timeoutMs:number}):Promise<Capabilities>` and `createLiveDataSource(ports:LivePorts):HereMateDataSource` with `mode==='live'` (`LivePorts` = the existing module functions injected, plus `now`, `fetchImpl`, and `background:{start(peerId:string,hours:BackgroundHours):Promise<void>;stop(reason:'user'|'mode'|'signout'):Promise<void>}` — a port Task 9 implements; until then the app passes a stub that rejects `NOT_AVAILABLE`). `stopAll()` calls `background.stop('mode')` before the foreground stop.

Probe rules (exact): `phoneLogin=false` (no route deployed); `wave=false`; `geofences` = `POST {base}/v1/geofences/review` without bearer returns 401/403 within 3000 ms (404, timeout or network error → false); `backgroundSharing` = same check on `POST {base}/v1/locations/background/start`.

- [ ] **Step 1: Failing tests:** probe → 401 ⇒ true, 404 ⇒ false, rejected fetch ⇒ false, slow (>3000 ms) ⇒ false; `signInPhone` rejects with `Error('NOT_AVAILABLE')`; `wave` rejects `NOT_AVAILABLE`; friend points map existing `friendMapStates` output with ages through `statusForAge`; `network_loss_marks_stale` — after a successful poll, poller errors: listener receives the same points with status `STALE` and `connected=false`; the source module never imports `src/data/demo` (assert by reading the file text).
- [ ] **Step 2–4:** fail → implement → pass. **Step 5: Commit** `feat(v2): live data source over existing staging modules`.

### Task 6: Map markers, zones and theme/strings

**Files:**
- Create: `src/map/status.ts`, `src/map/FriendMarker.tsx`, `src/map/ZoneCircle.tsx`, `src/app/theme.ts`, `src/app/strings.ts`
- Modify: `src/map/HereMap.tsx` (dark style, user dot, children)
- Test: `tests/v2-theme-strings.test.mjs`

**Interfaces:**
- Produces: `ringColor(s:FriendStatus):string` (LIVE `#2FB57C`, STALE `#C9A34A`, OFFLINE/SHARING_OFF `#A0AAB4`); `ageLabel(ms:number,lang:'th'|'en'):string` (`<60s`→`ตอนนี้`/`now`, `<60min`→`N นาทีที่แล้ว`/`N min ago`, else `N ชม.ที่แล้ว`/`N h ago`); `palette(theme)` returning the Global Constraints tokens; `S` dictionary with `th` and `en` objects and `useT()` hook; `circlePolygon(center:LatLng,radiusM:number,steps=48):[number,number][]`.
- [ ] **Step 1: Failing tests:** ring colors exact; age labels at 10 s, 2 min, 3 h in both languages; `Object.keys(S.th)` deep-equals `Object.keys(S.en)` and no value is empty; `circlePolygon` first point ≈ last point and every point within ±1 m of radius (haversine); `palette('light').accent==='#2F7CF6'`.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(v2): map markers, zones, theme tokens and TH/EN strings`.

### Task 7: App shell, components, Sign-in, Home and Friend detail

**Files:**
- Create: `src/app/nav.ts`, `src/app/components/{GlassCard,BottomSheet,ModeSwitch,TabBar,ComingSoon}.tsx`, `src/app/screens/{SignIn,Home,FriendDetail}.tsx`
- Modify: `HereMateApp.tsx` (providers: Preferences, Mode; shell: sign-in gate → tabs)
- Test: `tests/v2-home-ui.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: `nav.ts` `createNav()` pure reducer `{tab:'friends'|'places'|'me';stack:Array<{screen:'friend';id:string}|{screen:'addFriend'}|{screen:'primer';kind:'foreground'|'background'|'notifications'}|{screen:'backgroundConsent';friendId:string}>}` with actions `tab`, `push`, `pop`; `BottomSheet` props `{snap:'peek'|'half'|'full';onSnap;children}` (Animated + PanResponder, snap heights 0.22/0.5/0.88 of window); `ModeSwitch` props `{mode;onChange}`.

Screen requirements (from spec §3): Sign-in shows Google, Phone (only if `capabilities.phoneLogin`), Guest, and "ลองโหมดสาธิต ไม่ต้องสมัคร" which calls `switchTo('demo')`. Home: full-screen map, own blue dot, friend markers, top-left brand pill, top-right `ModeSwitch` with DEMO badge in demo, recenter button, friends sheet (search shown when > 8 friends), "Can't connect. Retry" banner when `connected===false`. Friend detail: name, place, `ageLabel`, distance, actions Directions (`androidGeoUri` from `src/location/androidGeoHandoff.ts`), Alerts (→ Places tab with friend preselected), Wave (demo works; live renders `ComingSoon`), consent row, "Stop sharing with {name}".

- [ ] **Step 1: Failing tests:** `createNav` reducer transitions (push/pop/tab resets stack); source checks: no file under `src/app/` imports `firebase`, `src/auth`, `src/location/m2`, or `src/data/demo|live` directly (only via `useHereMate`); `SignIn.tsx` hides phone button behind `capabilities.phoneLogin`; `empty_and_long_name_rendering` — friend list row text uses `numberOfLines={1}` and the empty state uses keys `emptyFriendsTitle`/`emptyFriendsBody`/`addFriend`.
- [ ] **Step 2–4.** Also run `npm run typecheck`. **Step 5: Commit** `feat(v2): shell, sign-in, map home and friend detail`.

### Task 8: Places, Me, Add friend, permission primer and background consent screens

**Files:**
- Create: `src/app/screens/{Places,Me,AddFriend,PermissionPrimer,BackgroundConsent}.tsx`
- Test: `tests/v2-secondary-ui.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–7. BackgroundConsent calls only `source.location.startBackground(friendId, hours)`; permission prompting happens inside the Live implementation (Task 9), and a rejection with `BACKGROUND_PERMISSION_DENIED` shows the primer's "open settings" state.
- Produces: screens registered in the shell.

Requirements: Places renders zone circles + list with state text (`active` / `waitingFor {name}`), latest alerts, privacy note key `placesPrivacyNote`, add flow (pick friend → radius slider 100–1000 m step 50 → label → `propose`), incoming proposals with approve/reject (`decide`); when `capabilities.geofences===false` shows `ComingSoon`. Me: avatar initials, name (rename), friend code, switches "Share my location" and "Share when the app is closed" (opens primer then `BackgroundConsent`), language, theme, mode, "Stop all sharing now" (`stopAll`), sign out. BackgroundConsent: who, what, ongoing notification, battery note, duration chips from `BACKGROUND_HOURS` default 1, Start/Cancel.

- [ ] **Step 1: Failing tests:** source checks that Places gates on `capabilities.geofences`; radius slider bounds 100/1000/50; BackgroundConsent iterates `BACKGROUND_HOURS` and defaults to `1`; Me's "Stop all sharing now" calls `location.stopAll`; background switch is hidden in Live when `capabilities.backgroundSharing===false` (renders `ComingSoon`).
- [ ] **Step 2–4** (+ typecheck). **Step 5: Commit** `feat(v2): places, me, add friend and consent screens`.

### Task 9: Background sharing — client policy and task

**Files:**
- Create: `src/location/background/backgroundPolicy.ts`, `src/location/background/backgroundTask.ts`
- Modify: `src/location/m2StagingTransport.ts` (add `startBackground(peer, deadlineMs)` and `publish(..., {background:true})` sending `appInForeground:false`)
- Test: `tests/v2-background-client.test.mjs`

**Interfaces:**
- Produces: `BACKGROUND_TASK='heremate.background-location'`; `clampDeadline(now:number,hours:BackgroundHours):number` (= now + hours·3 600 000, throws for any other hours); `shouldPublish(state:{deadlineMs:number;stopped:boolean},now:number):boolean`; `decideOnServerResult(r:'stored'|'denied'|'expired'|'network'):'continue'|'stop'|'retry'`; `startBackgroundSharing(ports,{peerId,hours}):Promise<void>`; `stopBackgroundSharing(ports,reason:'user'|'deadline'|'revoked'|'signout'|'mode'):Promise<void>`; `resumeOnLaunch(ports):Promise<'running'|'expired'|'none'>`; `requestBackgroundPermission():Promise<'granted'|'denied'>`. Persisted state key `heremate.v2.background` `{peerId,deadlineMs}`.
- Location options (exact): `accuracy: Balanced`, `distanceInterval: 25`, `timeInterval: 30000`, `foregroundService: {notificationTitle: 'HereMate กำลังแชร์ตำแหน่ง', notificationBody: 'แตะเพื่อเปิดแอปและหยุดแชร์', killServiceOnDestroy: false}`.

- [ ] **Step 1: Failing tests:** `clampDeadline` for 1/4/8 and throws for 2; `shouldPublish` false at/after deadline or when stopped; `decideOnServerResult('denied')==='stop'`, `'network'→'retry'`; `expired_deadline_not_resumed` — persisted deadline in the past → `resumeOnLaunch` returns `'expired'`, unregisters the task, clears state, does not call `startLocationUpdatesAsync`; `background_permission_denied_keeps_foreground` — permission denied → `startBackgroundSharing` rejects `BACKGROUND_PERMISSION_DENIED`, foreground controller untouched; `stopBackgroundSharing` calls `stopLocationUpdatesAsync` then transport `stop(peer)` and clears state even if `stop` throws; task publish with server `denied` stops the task.
- [ ] **Step 2–4.** Existing `tests/m2-4-staging-transport.test.mjs` and `tests/m2-2-foreground-share.test.mjs` still PASS. **Step 5: Commit** `feat(v2): background location task with 1/4/8h deadline`.

### Task 10: Background sharing — server

**Files:**
- Modify: `backend/location/location-service.mjs`, `backend/location/http.mjs`, `backend/location/firestore-location-adapters.mjs` (only if the grant shape needs the new field persisted)
- Test: `tests/v2-background-server.test.mjs` (fake Firestore from `tests/m2-1-server-location.test.mjs` pattern)

**Interfaces:**
- Produces: `BACKGROUND_MAX_MS=8*3_600_000`; service method `startBackground({idToken,viewerUid,deadlineMs})` → `{background:true,deadlineMs}`; route `'/v1/locations/background/start':{method:'startBackground',keys:['viewerUid','deadlineMs']}`; `publish` accepts `appInForeground:false` only per rules below.

Rules (exact): `startBackground` requires an existing unexpired grant and publisher lease for (owner, viewer), accepted relation, both consents, matching relation revision, and `now < deadlineMs ≤ now + BACKGROUND_MAX_MS`; it writes `grant.background={consentedAtMs:now,deadlineMs}`. Background publish (`appInForeground!==true`) requires all current foreground checks except the foreground flag, plus `grant.background.deadlineMs > now`; on success renews `grant.expiresAtMs` and publisher `expiresAtMs` to `min(now+GRANT_MS, deadlineMs)` in the same transaction. `stop`, consent off and relation change clear `background` with the grant. Foreground publish unchanged.

- [ ] **Step 1: Failing tests:** background publish without `startBackground` → `LocationDenied`; with it → stored and grant renewed to `min(now+60_000, deadline)`; `deadlineMs = now + 8h + 1` → `LocationInvalid`; after deadline → denied; after `stop` → denied; after recipient consent off → denied; wrong device lease (M3 session digest mismatch) → denied; foreground publish behaviour identical to before (re-run existing suite).
- [ ] **Step 2–4:** fail → implement → pass; `node --test tests/m2-1-server-location.test.mjs tests/m3-device-session-http.test.mjs tests/m3-pair-stop-collision.test.mjs` → PASS.
- [ ] **Step 5: Commit** `feat(backend): deadline-bound background publish (max 8h)`.
- [ ] **Step 6: Deploy gate (owner approval).** Report the exact workflow (`m2-staging-cloudrun.yml`) and SHA, ask the owner, dispatch only after "yes", then verify `POST /v1/locations/background/start` without bearer returns 401 (PASS) — otherwise Live shows Coming soon for background (BLOCKED reported).

### Task 11: CI wiring, integration check and delivery

**Files:**
- Modify: `.github/workflows/pr-ci.yml` (add one step per `tests/v2-*.test.mjs` file, plus `npm run typecheck`), `README.md` (one "HereMate v2 preview" section: flag, workflow, modes)
- Test: `tests/v2-foundation.test.mjs` (extend: every `tests/v2-*.test.mjs` file is referenced in `pr-ci.yml`)

- [ ] **Step 1:** extend test → FAIL. **Step 2:** edit workflow/README → PASS. Run all: `node --test tests/*.test.mjs` → all PASS (record counts).
- [ ] **Step 3: Commit** `ci(v2): run v2 tests in PR CI`; open PR to `main` with spec + plan links, PASS/BLOCKED/NOT VERIFIED table.
- [ ] **Step 4 (owner approval):** dispatch `pr-ci.yml` on the branch → SUCCESS; dispatch `android-v2-preview-apk.yml` → SUCCESS; download artifact, verify SHA-256, upload `HereMate-v2-Preview-<sha7>.apk` + manifest to the owner's Drive folder `HereMate` (id `1Q0zgRbKdt9l6ZeEU4KILSf_1vUjQ2gmo`).
- [ ] **Step 5:** independent fresh-context review of the whole branch against the spec before merge; owner device walkthrough checklist (spec §6) reported as NOT VERIFIED until the owner confirms.
