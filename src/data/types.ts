// HereMate v2 domain types and the single data-source interface that every
// screen uses. DemoDataSource (offline simulator) and LiveDataSource (existing
// Staging modules) both implement HereMateDataSource; screens never import
// Firebase, HTTP transports or the simulator directly.

export type Mode = 'demo' | 'live';
export type FriendStatus = 'LIVE' | 'STALE' | 'OFFLINE' | 'SHARING_OFF';
export type LatLng = Readonly<{ lat: number; lng: number }>;
export type Friend = Readonly<{
  id: string; name: string; initials: string; consentMine: boolean; consentTheirs: boolean;
}>;
export type FriendPoint = Readonly<{
  friendId: string; at: LatLng; capturedAtMs: number; status: FriendStatus; placeLabel?: string;
}>;
export type FriendRequestView = Readonly<{ id: string; direction: 'incoming' | 'outgoing'; name: string }>;
export type Zone = Readonly<{
  id: string; subjectId: string; label: string; center: LatLng; radiusM: number; state: 'pending' | 'active';
}>;
export type ZoneAlert = Readonly<{ zoneId: string; friendId: string; kind: 'enter' | 'exit'; atMs: number }>;
export type Capabilities = Readonly<{
  phoneLogin: boolean; geofences: boolean; backgroundSharing: boolean; wave: boolean;
}>;
export type BackgroundHours = 1 | 4 | 8;
export type SharingState = Readonly<{
  foregroundWith: string | null;
  background: null | Readonly<{ withId: string; deadlineMs: number }>;
}>;
export type Unsub = () => void;

export interface HereMateDataSource {
  readonly mode: Mode;
  capabilities(): Promise<Capabilities>;
  session: {
    current(): { uid: string; displayName: string } | null;
    signInGoogle(): Promise<void>;
    signInGuest(): Promise<void>;
    signInPhone(phone: string, password: string): Promise<void>;
    signOut(): Promise<void>;
  };
  profile: {
    get(): Promise<{ displayName: string; friendCode: string }>;
    rename(name: string): Promise<void>;
  };
  friends: {
    subscribe(fn: (friends: Friend[], requests: FriendRequestView[]) => void): Unsub;
    sendRequest(code: string): Promise<void>;
    respond(requestId: string, accept: boolean): Promise<void>;
    setConsent(friendId: string, on: boolean): Promise<void>;
    remove(friendId: string): Promise<void>;
  };
  location: {
    subscribeFriendPoints(fn: (points: FriendPoint[], connected: boolean) => void): Unsub;
    subscribeSharing(fn: (s: SharingState) => void): Unsub;
    startForeground(friendId: string): Promise<void>;
    startBackground(friendId: string, hours: BackgroundHours): Promise<void>;
    stopBackground(): Promise<void>;
    stop(): Promise<void>;
    stopAll(): Promise<void>;
    myPosition(): Promise<LatLng | null>;
  };
  places: {
    subscribe(fn: (zones: Zone[], alerts: ZoneAlert[]) => void): Unsub;
    propose(subjectId: string, center: LatLng, radiusM: number, label: string): Promise<void>;
    decide(zoneId: string, approve: boolean): Promise<void>;
    remove(zoneId: string): Promise<void>;
  };
  wave(friendId: string): Promise<void>;
}

export const BACKGROUND_HOURS: readonly BackgroundHours[] = Object.freeze([1, 4, 8] as const);
export const LIVE_MAX_AGE_MS = 30_000;
/** Same tolerance as the server's FIX_FUTURE_SKEW_MS. */
export const MAX_FUTURE_SKEW_MS = 5_000;

/** A point is LIVE only while fresh; stale data is never presented as live. */
export function statusForAge(ageMs: number, sharing: boolean, online: boolean): FriendStatus {
  if (!sharing) return 'SHARING_OFF';
  if (!online) return 'OFFLINE';
  if (!Number.isFinite(ageMs) || ageMs < -MAX_FUTURE_SKEW_MS || ageMs > LIVE_MAX_AGE_MS) return 'STALE';
  return 'LIVE';
}
