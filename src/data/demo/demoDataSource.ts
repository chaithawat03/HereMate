// Offline Demo data source: deterministic simulator, no network, no Firebase.
import {
  BACKGROUND_HOURS, statusForAge,
  type BackgroundHours, type Capabilities, type Friend, type FriendPoint, type FriendRequestView,
  type HereMateDataSource, type LatLng, type SharingState, type Zone, type ZoneAlert,
} from '../types.ts';
import {
  DEMO_FRIENDS, DEMO_INCOMING_REQUEST, DEMO_ZONES, distanceM, routePosition, zoneVisitorPosition,
} from './demoWorld.ts';

export const DEMO_TICK_MS = 3000;
export const DEMO_FALLBACK_POSITION: LatLng = Object.freeze({ lat: 13.7462, lng: 100.5347 });
const AUTO_APPROVE_TICKS = 3;
const HOUR_MS = 3_600_000;

export type DemoPorts = {
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  myGps?: () => Promise<LatLng | null>;
};

type Listener<A extends unknown[]> = (...args: A) => void;

export function createDemoDataSource(ports: DemoPorts): HereMateDataSource {
  const startedAt = ports.now();
  let tick = 0;
  let timer: unknown = null;
  let signedIn: { uid: string; displayName: string } | null = { uid: 'demo-me', displayName: 'ชัยธวัช' };

  let friends: Friend[] = DEMO_FRIENDS.map(f => ({
    id: f.id, name: f.name, initials: f.initials, consentMine: true, consentTheirs: f.kind !== 'sharingOff',
  }));
  let requests: FriendRequestView[] = [{ id: DEMO_INCOMING_REQUEST.id, direction: 'incoming', name: DEMO_INCOMING_REQUEST.name }];
  let zones: Zone[] = DEMO_ZONES.map(z => ({ ...z }));
  let alerts: ZoneAlert[] = [];
  const proposedAtTick = new Map<string, number>();
  const insideZone = new Map<string, boolean>();
  let sharing: SharingState = { foregroundWith: null, background: null };
  let nextId = 1;

  const pointListeners = new Set<Listener<[FriendPoint[], boolean]>>();
  const friendListeners = new Set<Listener<[Friend[], FriendRequestView[]]>>();
  const placeListeners = new Set<Listener<[Zone[], ZoneAlert[]]>>();
  const sharingListeners = new Set<Listener<[SharingState]>>();

  function points(): FriendPoint[] {
    const now = ports.now();
    const out: FriendPoint[] = [];
    for (const spec of DEMO_FRIENDS) {
      const friend = friends.find(f => f.id === spec.id);
      if (!friend || !friend.consentTheirs || !friend.consentMine) continue;
      if (spec.kind === 'route' && spec.from && spec.to) {
        out.push({ friendId: spec.id, at: routePosition(spec.from, spec.to, tick), capturedAtMs: now, status: 'LIVE', placeLabel: spec.placeLabel });
      } else if (spec.kind === 'zoneVisitor') {
        out.push({ friendId: spec.id, at: zoneVisitorPosition(tick), capturedAtMs: now, status: 'LIVE', placeLabel: spec.placeLabel });
      } else if (spec.at && spec.ageMs !== undefined) {
        const capturedAtMs = startedAt - spec.ageMs;
        const status = spec.kind === 'offline' ? 'OFFLINE' : statusForAge(now - capturedAtMs, true, true);
        out.push({ friendId: spec.id, at: spec.at, capturedAtMs, status, placeLabel: spec.placeLabel });
      }
    }
    return out;
  }

  const emitPoints = () => { const p = points(); pointListeners.forEach(fn => fn(p, true)); };
  const emitFriends = () => friendListeners.forEach(fn => fn([...friends], [...requests]));
  const emitPlaces = () => placeListeners.forEach(fn => fn([...zones], [...alerts]));
  const emitSharing = () => sharingListeners.forEach(fn => fn(sharing));
  const setSharing = (next: SharingState) => { sharing = next; emitSharing(); };

  function checkZones(current: FriendPoint[]) {
    const now = ports.now();
    for (const zone of zones) {
      if (zone.state !== 'active') continue;
      const p = current.find(x => x.friendId === zone.subjectId && x.status === 'LIVE');
      if (!p) continue;
      const inside = distanceM(p.at, zone.center) <= zone.radiusM;
      const was = insideZone.get(zone.id);
      insideZone.set(zone.id, inside);
      if (was === undefined || was === inside) continue;
      const alert: ZoneAlert = { zoneId: zone.id, friendId: zone.subjectId, kind: inside ? 'enter' : 'exit', atMs: now };
      alerts = [alert, ...alerts].slice(0, 20);
    }
  }

  function step() {
    tick++;
    const now = ports.now();
    if (sharing.background && now >= sharing.background.deadlineMs) setSharing({ ...sharing, background: null });
    zones = zones.map(z => {
      const at = proposedAtTick.get(z.id);
      return at !== undefined && z.state === 'pending' && tick - at >= AUTO_APPROVE_TICKS ? { ...z, state: 'active' } : z;
    });
    const current = points();
    checkZones(current);
    pointListeners.forEach(fn => fn(current, true));
    emitPlaces();
  }

  function ensureRunning() {
    if (timer === null) {
      checkZones(points()); // record initial inside/outside state without alerting
      timer = ports.setInterval(step, DEMO_TICK_MS);
    }
  }

  function subscribe<A extends unknown[]>(set: Set<Listener<A>>, fn: Listener<A>, initial: () => void) {
    set.add(fn);
    initial();
    ensureRunning();
    return () => { set.delete(fn); };
  }

  const capabilities: Capabilities = { phoneLogin: true, geofences: true, backgroundSharing: true, wave: true };

  return {
    mode: 'demo',
    capabilities: async () => capabilities,
    session: {
      current: () => signedIn,
      signInGoogle: async () => { signedIn = { uid: 'demo-me', displayName: 'ชัยธวัช' }; },
      signInGuest: async () => { signedIn = { uid: 'demo-guest', displayName: 'ผู้เยี่ยมชม' }; },
      signInPhone: async (phone, password) => {
        if (!phone.trim() || !password) throw Error('INVALID_CREDENTIALS');
        signedIn = { uid: 'demo-me', displayName: 'ชัยธวัช' };
      },
      signOut: async () => { signedIn = null; },
    },
    profile: {
      get: async () => ({ displayName: signedIn?.displayName ?? 'ชัยธวัช', friendCode: 'HM-4821' }),
      rename: async name => {
        const trimmed = name.trim();
        if (!trimmed) throw Error('INVALID_NAME');
        if (signedIn) signedIn = { ...signedIn, displayName: trimmed };
      },
    },
    friends: {
      subscribe: fn => subscribe(friendListeners, fn, () => fn([...friends], [...requests])),
      sendRequest: async code => {
        if (!code.trim()) throw Error('INVALID_CODE');
        requests = [...requests, { id: 'req-' + nextId++, direction: 'outgoing', name: code.trim() }];
        emitFriends();
      },
      respond: async (requestId, accept) => {
        const req = requests.find(r => r.id === requestId);
        requests = requests.filter(r => r.id !== requestId);
        if (req && accept && req.direction === 'incoming') {
          friends = [...friends, { id: req.id, name: req.name, initials: req.name.slice(0, 3), consentMine: true, consentTheirs: false }];
        }
        emitFriends();
      },
      setConsent: async (friendId, on) => {
        friends = friends.map(f => (f.id === friendId ? { ...f, consentMine: on } : f));
        emitFriends(); emitPoints();
      },
      remove: async friendId => {
        friends = friends.filter(f => f.id !== friendId);
        if (sharing.foregroundWith === friendId || sharing.background?.withId === friendId) {
          setSharing({ foregroundWith: null, background: null });
        }
        emitFriends(); emitPoints();
      },
    },
    location: {
      subscribeFriendPoints: fn => subscribe(pointListeners, fn, () => fn(points(), true)),
      subscribeSharing: fn => { sharingListeners.add(fn); fn(sharing); return () => { sharingListeners.delete(fn); }; },
      startForeground: async friendId => { ensureRunning(); setSharing({ ...sharing, foregroundWith: friendId }); },
      startBackground: async (friendId, hours: BackgroundHours) => {
        if (!BACKGROUND_HOURS.includes(hours)) throw Error('INVALID_BACKGROUND_HOURS');
        ensureRunning();
        setSharing({ ...sharing, background: { withId: friendId, deadlineMs: ports.now() + hours * HOUR_MS } });
      },
      stopBackground: async () => setSharing({ ...sharing, background: null }),
      stop: async () => setSharing({ ...sharing, foregroundWith: null }),
      stopAll: async () => {
        if (timer !== null) { ports.clearInterval(timer); timer = null; }
        setSharing({ foregroundWith: null, background: null });
      },
      myPosition: async () => (ports.myGps ? (await ports.myGps()) ?? DEMO_FALLBACK_POSITION : DEMO_FALLBACK_POSITION),
    },
    places: {
      subscribe: fn => subscribe(placeListeners, fn, () => fn([...zones], [...alerts])),
      propose: async (subjectId, center, radiusM, label) => {
        const id = 'zone-' + nextId++;
        zones = [...zones, { id, subjectId, label: label.trim() || 'สถานที่', center, radiusM, state: 'pending' }];
        proposedAtTick.set(id, tick);
        ensureRunning();
        emitPlaces();
      },
      decide: async (zoneId, approve) => {
        zones = approve ? zones.map(z => (z.id === zoneId ? { ...z, state: 'active' } : z)) : zones.filter(z => z.id !== zoneId);
        emitPlaces();
      },
      remove: async zoneId => { zones = zones.filter(z => z.id !== zoneId); emitPlaces(); },
    },
    wave: async () => {},
  };
}
