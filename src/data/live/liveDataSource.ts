// Live data source: adapts the existing Staging modules (Firebase auth,
// Firestore friends/profile, M2 sharing controller, M2 friend-map reads,
// background task) to HereMateDataSource. All authorization stays server-side;
// this adapter never invents data and never shows expired coordinates.
import {
  BACKGROUND_HOURS,
  type BackgroundHours, type Capabilities, type Friend, type FriendPoint, type FriendRequestView,
  type HereMateDataSource, type LatLng, type SharingState, type Unsub, type Zone,
} from '../types.ts';
import { friendMapStates, validatedRemoteFix } from '../../location/m2FriendLocationView.ts';
import type { FriendRequest } from '../../friends/friendModel.ts';

export type LiveSnapshot = Readonly<{
  viewerUid: string; relations: readonly FriendRequest[]; reads: Readonly<Record<string, unknown>>; nowMs: number;
}>;

export type LivePorts = {
  now: () => number;
  probe: () => Promise<Capabilities>;
  auth: {
    current: () => { uid: string; displayName: string } | null;
    signInGuest: () => Promise<unknown>;
    signInGoogle: () => Promise<unknown>;
    signOut: () => Promise<unknown>;
  };
  profile: {
    get: () => Promise<{ displayName: string; friendCode: string }>;
    rename: (name: string) => Promise<unknown>;
  };
  friends: {
    list: () => Promise<FriendRequest[]>;
    send: (code: string) => Promise<unknown>;
    act: (request: FriendRequest, action: 'accepted' | 'declined' | 'cancelled' | 'removed') => Promise<unknown>;
    setConsent: (request: FriendRequest, on: boolean) => Promise<unknown>;
  };
  /** Starts foreground-only authorized friend-map polling; returns a stop function. */
  map: { start: (onSnapshot: (s: LiveSnapshot) => void, onError: () => void) => () => void };
  sharing: {
    start: (peerUid: string) => Promise<unknown>;
    stop: () => Promise<unknown>;
    subscribe: (fn: (peerUid: string | null) => void) => Unsub;
  };
  background: {
    /** `beforeGrant` runs only after OS permissions are granted, right before the server share starts. */
    start: (peerUid: string, hours: BackgroundHours, opts?: { beforeGrant?: () => Promise<unknown> }) => Promise<unknown>;
    stop: (reason: 'user' | 'mode' | 'signout') => Promise<unknown>;
    current: () => { withId: string; deadlineMs: number } | null;
    /** Fires when background sharing changes on its own (deadline, revoked, task resume). */
    subscribe?: (fn: () => void) => Unsub;
    /** Last automatic/manual end of background sharing (persisted by the task). */
    lastStopped?: () => { atMs: number; reason: 'user' | 'deadline' | 'revoked' | 'signout' | 'mode' } | null;
  };
  /** Geofence transport when deployed; null keeps Places "coming soon". */
  places: null | {
    propose: (subjectUid: string, center: LatLng, radiusM: number) => Promise<unknown>;
  };
  myPosition: () => Promise<LatLng | null>;
  /** Remove wiring-level listeners (AppState/auth) when this source is released. */
  dispose?: () => void;
};

const notAvailable = () => Promise.reject(Error('NOT_AVAILABLE'));

function peerOf(r: FriendRequest, me: string): { uid: string; name: string } {
  return r.senderUid === me
    ? { uid: r.recipientUid, name: r.recipientDisplayName || r.recipientUid.slice(0, 8) }
    : { uid: r.senderUid, name: r.senderDisplayName || r.senderUid.slice(0, 8) };
}
const initialsOf = (name: string) => Array.from(name.trim()).slice(0, 3).join('') || '?';

export function toFriendPoints(s: LiveSnapshot): FriendPoint[] {
  return friendMapStates({ viewerUid: s.viewerUid, relations: s.relations, reads: s.reads, nowMs: s.nowMs }).map(row => {
    const fix = row.status === 'LIVE' ? validatedRemoteFix(s.reads[row.peerUid], s.nowMs) : null;
    if (fix) {
      return { friendId: row.peerUid, at: { lat: fix.point.latitude, lng: fix.point.longitude }, capturedAtMs: fix.point.capturedAtMs, status: 'LIVE' };
    }
    if (row.status === 'STALE') {
      const raw = s.reads[row.peerUid] as { point?: { capturedAtMs?: unknown } } | undefined;
      const t = raw?.point?.capturedAtMs;
      return { friendId: row.peerUid, at: null, capturedAtMs: typeof t === 'number' && Number.isFinite(t) ? t : null, status: 'STALE' };
    }
    // SHARING_OFF or UNAVAILABLE: no coordinates, never claimed OFFLINE.
    return { friendId: row.peerUid, at: null, capturedAtMs: null, status: 'SHARING_OFF' };
  });
}

export function createLiveDataSource(p: LivePorts): HereMateDataSource {
  let relations: FriendRequest[] = [];
  let caps: Promise<Capabilities> | null = null;
  let lastPoints: FriendPoint[] = [];
  let stopMap: (() => void) | null = null;
  let foregroundWith: string | null = null;
  let localZones: Zone[] = [];

  const pointListeners = new Set<(p: FriendPoint[], c: boolean) => void>();
  const friendListeners = new Set<(f: Friend[], q: FriendRequestView[]) => void>();
  const sharingListeners = new Set<(s: SharingState) => void>();
  const placeListeners = new Set<(z: Zone[], a: []) => void>();

  const me = () => p.auth.current()?.uid ?? null;
  const sharingState = (): SharingState => ({
    foregroundWith, background: p.background.current(), lastBackgroundStop: p.background.lastStopped?.() ?? null,
  });
  const emitSharing = () => { const s = sharingState(); sharingListeners.forEach(fn => fn(s)); };
  const emitPlaces = () => placeListeners.forEach(fn => fn([...localZones], []));

  function views(): { friends: Friend[]; requests: FriendRequestView[] } {
    const uid = me();
    if (!uid) return { friends: [], requests: [] };
    const friends: Friend[] = [], requests: FriendRequestView[] = [];
    for (const r of relations) {
      if (r.senderUid !== uid && r.recipientUid !== uid) continue;
      const peer = peerOf(r, uid);
      const mine = r.senderUid === uid ? r.senderConsent : r.recipientConsent;
      const theirs = r.senderUid === uid ? r.recipientConsent : r.senderConsent;
      if (r.status === 'accepted') friends.push({ id: peer.uid, name: peer.name, initials: initialsOf(peer.name), consentMine: mine, consentTheirs: theirs });
      else if (r.status === 'pending') requests.push({ id: r.id, direction: r.senderUid === uid ? 'outgoing' : 'incoming', name: peer.name });
    }
    return { friends, requests };
  }
  async function reload() {
    relations = await p.friends.list();
    const v = views();
    friendListeners.forEach(fn => fn(v.friends, v.requests));
  }
  function relationWith(friendId: string): FriendRequest {
    const uid = me();
    const r = relations.find(x => x.status === 'accepted' && uid !== null && peerOf(x, uid).uid === friendId);
    if (!r) throw Error('NOT_A_FRIEND');
    return r;
  }

  function onSnapshot(s: LiveSnapshot) {
    lastPoints = toFriendPoints(s);
    pointListeners.forEach(fn => fn(lastPoints, true));
  }
  function onMapError() {
    lastPoints = lastPoints.map(pt => (pt.status === 'LIVE' ? { ...pt, status: 'STALE', at: null } : pt));
    pointListeners.forEach(fn => fn(lastPoints, false));
  }
  function stopPolling() { if (stopMap) { stopMap(); stopMap = null; } }

  const unsubSharing = p.sharing.subscribe(peer => { foregroundWith = peer; emitSharing(); });
  const unsubBackground = p.background.subscribe?.(emitSharing);

  return {
    mode: 'live',
    capabilities: () => (caps ??= p.probe().catch(() => ({ phoneLogin: false, geofences: false, backgroundSharing: false, wave: false }))),
    session: {
      current: () => p.auth.current(),
      signInGoogle: async () => { await p.auth.signInGoogle(); },
      signInGuest: async () => { await p.auth.signInGuest(); },
      signInPhone: () => notAvailable(),
      signOut: async () => {
        await p.background.stop('signout').catch(() => {});
        await p.sharing.stop().catch(() => {});
        stopPolling();
        await p.auth.signOut();
      },
    },
    profile: { get: () => p.profile.get(), rename: async name => { await p.profile.rename(name); } },
    friends: {
      subscribe: fn => {
        friendListeners.add(fn);
        const v = views(); fn(v.friends, v.requests);
        void reload().catch(() => {});
        return () => { friendListeners.delete(fn); };
      },
      sendRequest: async code => { await p.friends.send(code.trim()); await reload(); },
      respond: async (requestId, accept) => {
        const r = relations.find(x => x.id === requestId);
        if (!r) throw Error('NOT_FOUND');
        const incoming = r.recipientUid === me();
        await p.friends.act(r, accept ? 'accepted' : incoming ? 'declined' : 'cancelled');
        await reload();
      },
      setConsent: async (friendId, on) => { await p.friends.setConsent(relationWith(friendId), on); await reload(); },
      remove: async friendId => { await p.friends.act(relationWith(friendId), 'removed'); await reload(); },
    },
    location: {
      subscribeFriendPoints: fn => {
        pointListeners.add(fn);
        fn(lastPoints, true);
        if (!stopMap) stopMap = p.map.start(onSnapshot, onMapError);
        return () => {
          pointListeners.delete(fn);
          if (pointListeners.size === 0) stopPolling();
        };
      },
      subscribeSharing: fn => { sharingListeners.add(fn); fn(sharingState()); return () => { sharingListeners.delete(fn); }; },
      startForeground: async friendId => {
        // Background sharing already covers this friend; another friend would hit the owner lease.
        const bg = p.background.current();
        if (bg) { if (bg.withId === friendId) return; throw Error('BACKGROUND_ACTIVE'); }
        await p.sharing.start(friendId);
      },
      startBackground: async (friendId, hours) => {
        if (!BACKGROUND_HOURS.includes(hours)) throw Error('INVALID_BACKGROUND_HOURS');
        // The foreground controller sends STOP when the app closes, which would delete the
        // grant the background task relies on, so foreground sharing is handed over — but only
        // once "Allow all the time" is granted, so a denial keeps foreground sharing running.
        await p.background.start(friendId, hours, {
          beforeGrant: async () => { if (foregroundWith !== null) await p.sharing.stop(); },
        });
        emitSharing();
      },
      stopBackground: async () => { await p.background.stop('user'); emitSharing(); },
      stop: async () => { await p.sharing.stop(); },
      stopAll: async () => {
        await p.background.stop('mode').catch(() => {});
        await p.sharing.stop().catch(() => {});
        stopPolling();
        emitSharing();
      },
      myPosition: () => p.myPosition(),
    },
    places: {
      subscribe: fn => { placeListeners.add(fn); fn([...localZones], []); return () => { placeListeners.delete(fn); }; },
      propose: async (subjectId, center, radiusM, label) => {
        if (!p.places || !(await (caps ??= p.probe())).geofences) return notAvailable();
        await p.places.propose(subjectId, center, radiusM);
        localZones = [...localZones, { id: 'proposal-' + subjectId, subjectId, label, center, radiusM, state: 'pending' }];
        emitPlaces();
      },
      decide: () => notAvailable(),
      remove: () => notAvailable(),
    },
    wave: () => notAvailable(),
    // Never touches background sharing: closing the app UI must not end a closed-app share.
    dispose: () => {
      stopPolling();
      void p.sharing.stop().catch(() => {});
      unsubSharing();
      unsubBackground?.();
      p.dispose?.();
      pointListeners.clear(); friendListeners.clear(); sharingListeners.clear(); placeListeners.clear();
    },
  };
}
