// Subscriptions to the active data source. Screens use these hooks only.
import { useEffect, useState } from 'react';
import { useHereMate } from '../data/ModeProvider';
import type {
  Capabilities, Friend, FriendPoint, FriendRequestView, LatLng, SharingState, Zone, ZoneAlert,
} from '../data/types';

const NO_CAPS: Capabilities = { phoneLogin: false, geofences: false, backgroundSharing: false, wave: false };

export function useCaps(): Capabilities {
  const { source } = useHereMate();
  const [caps, setCaps] = useState<Capabilities>(source.mode === 'demo'
    ? { phoneLogin: true, geofences: true, backgroundSharing: true, wave: true } : NO_CAPS);
  useEffect(() => {
    let alive = true;
    source.capabilities().then(c => { if (alive) setCaps(c); }, () => {});
    return () => { alive = false; };
  }, [source]);
  return caps;
}

/** Firebase restores sessions asynchronously and the interface has no auth event, so poll briefly. */
export function useSession() {
  const { source } = useHereMate();
  const [session, setSession] = useState(() => source.session.current());
  useEffect(() => {
    setSession(source.session.current());
    const h = setInterval(() => {
      const next = source.session.current();
      setSession(prev => (prev?.uid === next?.uid && prev?.displayName === next?.displayName ? prev : next));
    }, 1000);
    return () => clearInterval(h);
  }, [source]);
  return { session, refresh: () => setSession(source.session.current()) };
}

export function useFriends() {
  const { source } = useHereMate();
  const [state, setState] = useState<{ friends: Friend[]; requests: FriendRequestView[] }>({ friends: [], requests: [] });
  useEffect(() => source.friends.subscribe((friends, requests) => setState({ friends, requests })), [source]);
  return state;
}

export function usePoints() {
  const { source } = useHereMate();
  const [state, setState] = useState<{ points: FriendPoint[]; connected: boolean }>({ points: [], connected: true });
  useEffect(() => source.location.subscribeFriendPoints((points, connected) => setState({ points, connected })), [source]);
  return state;
}

export function useSharing(): SharingState {
  const { source } = useHereMate();
  const [state, setState] = useState<SharingState>({ foregroundWith: null, background: null });
  useEffect(() => source.location.subscribeSharing(setState), [source]);
  return state;
}

export function usePlaces() {
  const { source } = useHereMate();
  const [state, setState] = useState<{ zones: Zone[]; alerts: ZoneAlert[] }>({ zones: [], alerts: [] });
  useEffect(() => source.places.subscribe((zones, alerts) => setState({ zones, alerts })), [source]);
  return state;
}

export function useMyPosition(): { at: LatLng | null; simulated: boolean } {
  const { source } = useHereMate();
  const [at, setAt] = useState<LatLng | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => source.location.myPosition().then(p => { if (alive) setAt(p); }, () => {});
    void load();
    const h = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(h); };
  }, [source]);
  return { at, simulated: source.mode === 'demo' };
}

/** Re-render periodically so "updated N min ago" labels stay honest. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  return now;
}
