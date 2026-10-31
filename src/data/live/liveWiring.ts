// React Native wiring: builds LivePorts from the existing reviewed Staging
// modules. Mirrors the account/foreground fencing of M2SharingPanel and
// M2FriendLocationPanel so the v2 UI inherits their safety behaviour.
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import { onAuthStateChanged } from 'firebase/auth';
import { getStagingGuestAuth, startGuestSession, stopGuestSession } from '../../auth/firebaseGuest';
import { continueStagingGoogleWithNativeToken } from '../../auth/googleAccountFirebase';
import { obtainNativeGoogleIdToken } from '../../auth/nativeGoogleSignIn';
import { firebaseStagingIdentity } from '../../config/firebaseStaging';
import { actOnRequest, listOwnRequests, ownInviteCode, sendFriendRequest, setOwnFriendConsent } from '../../friends/firestoreFriends';
import type { FriendRequest } from '../../friends/friendModel';
import { createOwnProfile, loadOwnProfile, renameOwnProfile } from '../../profile/firestoreProfile';
import { createM2StagingTransport, APPROVED_M2_STAGING_ORIGINS } from '../../location/m2StagingTransport';
import { createForegroundSharingController, type ShareFix, type ShareRelation, type SharingState as M2State } from '../../location/m2ForegroundSession';
import { bindVerifiedForegroundWatch } from '../../location/androidForegroundWatchBind';
import { createAndroidFriendMapPoller } from '../../location/androidFriendMapPoller';
import { loadAuthorizedFriendMap } from '../../location/accountScopedFriendMapRead';
import { authorizedPeers } from '../../location/m2FriendLocationView';
import { createM4StagingTransport, APPROVED_M4_STAGING_ORIGINS } from '../../geofences/m4StagingTransport';
import { probeCapabilities, PROBE_TIMEOUT_MS } from './capabilities';
import { refreshFriendMap } from './friendMapRefresh';
import type { LivePorts } from './liveDataSource';
import type { BackgroundHours, LatLng } from '../types';

export const LIVE_BASE_URL = APPROVED_M2_STAGING_ORIGINS[1];
const RENEW_DELAY_MS = 1000;

const foreground = () => AppState.currentState === 'active';
const toRelation = (r: FriendRequest): ShareRelation => ({
  senderUid: r.senderUid, recipientUid: r.recipientUid, status: r.status,
  senderConsent: r.senderConsent, recipientConsent: r.recipientConsent,
});

async function foregroundPermissionGranted(): Promise<boolean> {
  if (!foreground() || !await Location.hasServicesEnabledAsync()) return false;
  return (await Location.getForegroundPermissionsAsync()).granted === true;
}

export type BackgroundPort = LivePorts['background'];

export function createLivePorts(background: BackgroundPort): LivePorts {
  const auth = getStagingGuestAuth();
  const identity = () => {
    const user = auth.currentUser;
    return user ? { uid: user.uid, getIdToken: () => user.getIdToken() } : null;
  };
  const transport = createM2StagingTransport({
    approvedCloudRunUrl: LIVE_BASE_URL,
    projectId: firebaseStagingIdentity.projectId,
    currentIdentity: identity,
    isForeground: foreground,
    foregroundPermissionGranted,
    useDeviceSessions: false,
    fetchImpl: fetch,
  });

  // ---- foreground sharing (existing M2 controller, auto-renewed while the user wants it) ----
  let account: string | null = auth.currentUser?.uid ?? null;
  let wanted: string | null = null;
  let state: M2State = { phase: 'off', peerUid: null, expiresAtMs: null, error: null };
  const sharingListeners = new Set<(peer: string | null) => void>();
  const emit = () => {
    const peer = state.phase === 'sharing' || state.phase === 'starting' ? state.peerUid : null;
    sharingListeners.forEach(fn => fn(peer));
  };
  async function relationFor(peer: string): Promise<ShareRelation | null> {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;
    const rows = await listOwnRequests();
    const r = rows.find(x => x.status === 'accepted' &&
      ((x.senderUid === uid && x.recipientUid === peer) || (x.recipientUid === uid && x.senderUid === peer)));
    return r ? toRelation(r) : null;
  }
  const controller = createForegroundSharingController({
    ownerUid: () => (auth.currentUser?.uid === account ? account : null),
    isForeground: foreground,
    now: Date.now,
    schedule: (f, ms) => setTimeout(f, ms),
    cancel: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    transport,
    onState: next => {
      state = next;
      emit();
      // The M2 grant lasts 60 s. Renew while the user still wants to share and
      // nothing failed; any error, permission loss or account change ends it.
      if (next.phase === 'off' && next.error === null && wanted && foreground()) {
        const peer = wanted;
        setTimeout(() => { if (wanted === peer) void startShare(peer); }, RENEW_DELAY_MS);
      } else if (next.phase === 'off' && next.error !== null) {
        wanted = null;
      }
    },
    askForegroundPermission: async () => {
      if (!await Location.hasServicesEnabledAsync()) return false;
      return (await Location.requestForegroundPermissionsAsync()).granted === true;
    },
    watchForegroundFix: async (onFix, onError) => {
      const actor = auth.currentUser?.uid ?? null;
      if (!actor || actor !== account || !foreground()) throw Error('ANDROID_FOREGROUND_IDENTITY_CHANGED');
      let watching = true;
      const current = () => watching && actor === account && auth.currentUser?.uid === actor && foreground();
      const sub = await bindVerifiedForegroundWatch(
        () => Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 10_000, distanceInterval: 20 },
          value => {
            if (!current()) return;
            const fix: ShareFix = {
              latitude: value.coords.latitude, longitude: value.coords.longitude,
              accuracyMeters: value.coords.accuracy ?? Infinity, capturedAtMs: value.timestamp,
            };
            onFix(fix);
          },
          () => { if (current()) onError(); }),
        async () => current() && await foregroundPermissionGranted(),
      );
      return { remove: () => { watching = false; sub.remove(); } };
    },
  });
  async function startShare(peer: string) {
    const relation = await relationFor(peer);
    if (!relation) { wanted = null; throw Error('NOT_ELIGIBLE'); }
    await controller.start(peer, relation);
  }
  AppState.addEventListener('change', next => { if (next !== 'active') { wanted = null; controller.interrupted(); } });
  onAuthStateChanged(auth, u => {
    const uid = u?.uid ?? null;
    if (uid !== account) { account = uid; wanted = null; controller.accountChanged(); }
  });

  return {
    now: Date.now,
    probe: () => probeCapabilities({ fetchImpl: fetch as never, baseUrl: LIVE_BASE_URL, timeoutMs: PROBE_TIMEOUT_MS }),
    auth: {
      current: () => {
        const u = auth.currentUser;
        return u ? { uid: u.uid, displayName: u.displayName ?? '' } : null;
      },
      signInGuest: () => startGuestSession(auth),
      signInGoogle: async () => {
        if (!auth.currentUser) await startGuestSession(auth);
        const result = await continueStagingGoogleWithNativeToken(obtainNativeGoogleIdToken);
        if (result.kind !== 'linked' && result.kind !== 'signed-in' && result.kind !== 'already-google') throw Error('GOOGLE_' + result.kind.toUpperCase());
      },
      signOut: () => stopGuestSession(auth),
    },
    profile: {
      get: async () => {
        const profile = await loadOwnProfile() ?? await createOwnProfile(auth.currentUser?.displayName || 'HereMate');
        return { displayName: profile.displayName, friendCode: ownInviteCode() };
      },
      rename: name => renameOwnProfile(name),
    },
    friends: {
      list: listOwnRequests,
      send: sendFriendRequest,
      act: (r, a) => actOnRequest(r, a),
      setConsent: (r, on) => setOwnFriendConsent(r, on),
    },
    map: {
      start: (onSnapshot, onError) => {
        let generation = 0;
        const poller = createAndroidFriendMapPoller({
          isAndroid: () => Platform.OS === 'android',
          isForeground: foreground,
          currentUid: () => auth.currentUser?.uid ?? null,
          now: Date.now,
          scheduleInterval: (tick, ms) => setInterval(tick, ms),
          cancelInterval: h => clearInterval(h as ReturnType<typeof setInterval>),
          onActive: () => {},
          refresh: async () => {
            const run = ++generation;
            const uid = auth.currentUser?.uid;
            if (!uid) return;
            const isCurrent = () => run === generation && auth.currentUser?.uid === uid && foreground();
            await refreshFriendMap({
              viewerUid: uid, now: Date.now, isCurrent, onSnapshot, onError,
              load: () => loadAuthorizedFriendMap({
                viewerUid: uid, isCurrent, loadRelations: listOwnRequests, selectPeers: authorizedPeers,
                readPeer: peer => transport.read(peer),
              }),
            });
          },
        });
        poller.start();
        const sub = AppState.addEventListener('change', next => { if (next === 'active') poller.start(); });
        return () => { ++generation; sub.remove(); poller.dispose(); };
      },
    },
    sharing: {
      start: async peer => { wanted = peer; await startShare(peer); },
      stop: async () => { wanted = null; await controller.stop(); },
      subscribe: fn => { sharingListeners.add(fn); fn(null); return () => { sharingListeners.delete(fn); }; },
    },
    background,
    places: {
      propose: async (subjectUid: string, center: LatLng, radiusM: number) => {
        const m4 = createM4StagingTransport({
          approvedCloudRunUrl: APPROVED_M4_STAGING_ORIGINS[0],
          projectId: firebaseStagingIdentity.projectId,
          currentIdentity: identity,
          isForeground: foreground,
          foregroundPermissionGranted,
          fetchImpl: fetch,
        });
        await m4.propose(subjectUid, { latitude: center.lat, longitude: center.lng, radiusMeters: radiusM });
      },
    },
    myPosition: async () => {
      if (!await foregroundPermissionGranted()) return null;
      const last = await Location.getLastKnownPositionAsync();
      return last ? { lat: last.coords.latitude, lng: last.coords.longitude } : null;
    },
  };
}

/** Placeholder until the background task (plan Task 9) is wired. */
export const backgroundNotAvailable: BackgroundPort = {
  start: async (_peer: string, _hours: BackgroundHours) => { throw Error('NOT_AVAILABLE'); },
  stop: async () => {},
  current: () => null,
};
