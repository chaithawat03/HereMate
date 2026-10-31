// Synthetic demo world around central Bangkok. No real people, no real tracks.
// Routes follow approximate real streets so pins look natural on the map.
import type { LatLng } from '../types.ts';

export type DemoKind = 'route' | 'stale' | 'offline' | 'sharingOff' | 'zoneVisitor';
export type DemoFriendSpec = Readonly<{
  id: string; name: string; initials: string; kind: DemoKind; placeLabel: string;
  /** Route endpoints (ping-pong) for moving friends; fixed point otherwise. */
  from?: LatLng; to?: LatLng; at?: LatLng;
  /** Age of the last point at demo start, for STALE/OFFLINE friends. */
  ageMs?: number;
}>;

const MIN = 60_000;
const HOUR = 60 * MIN;

export const HOME_ZONE_CENTER: LatLng = { lat: 13.7315, lng: 100.5440 };

export const DEMO_FRIENDS: readonly DemoFriendSpec[] = Object.freeze([
  { id: 'mint', name: 'มิ้น', initials: 'มิ้น', kind: 'route', placeLabel: 'สยาม',
    from: { lat: 13.7461, lng: 100.5290 }, to: { lat: 13.7466, lng: 100.5395 } },          // Rama I Rd
  { id: 'ton', name: 'ต้น', initials: 'ต้น', kind: 'route', placeLabel: 'สีลม',
    from: { lat: 13.7290, lng: 100.5350 }, to: { lat: 13.7228, lng: 100.5222 } },          // Silom Rd
  { id: 'bam', name: 'แบม', initials: 'แบม', kind: 'zoneVisitor', placeLabel: 'ลุมพินี' }, // Wireless Rd → home
  { id: 'pond', name: 'ปอนด์', initials: 'ปอ', kind: 'route', placeLabel: 'อารีย์',
    from: { lat: 13.7720, lng: 100.5440 }, to: { lat: 13.7850, lng: 100.5462 } },          // Phahonyothin Rd
  { id: 'fah', name: 'ฟ้า', initials: 'ฟ้า', kind: 'stale', placeLabel: 'ทองหล่อ',
    at: { lat: 13.7325, lng: 100.5840 }, ageMs: 25 * MIN },
  { id: 'nat', name: 'นัท', initials: 'นัท', kind: 'stale', placeLabel: 'เยาวราช',
    at: { lat: 13.7400, lng: 100.5090 }, ageMs: 2 * HOUR },
  { id: 'jay', name: 'เจ', initials: 'เจ', kind: 'offline', placeLabel: 'บางนา',
    at: { lat: 13.6680, lng: 100.6050 }, ageMs: 6 * HOUR },
  { id: 'khaohom', name: 'ข้าวหอม', initials: 'ข้าว', kind: 'sharingOff', placeLabel: '' },
]);

export const DEMO_ZONES = Object.freeze([
  { id: 'home', subjectId: 'bam', label: 'บ้าน', center: HOME_ZONE_CENTER, radiusM: 200, state: 'active' as const },
  { id: 'uni', subjectId: 'mint', label: 'มหาวิทยาลัย', center: { lat: 13.7380, lng: 100.5320 }, radiusM: 300, state: 'pending' as const },
]);

export const DEMO_INCOMING_REQUEST = Object.freeze({ id: 'req-ploy', name: 'พลอย' });

/** Ping-pong along a straight street segment, ROUTE_STEPS ticks per direction. */
export const ROUTE_STEPS = 20;
export function routePosition(from: LatLng, to: LatLng, tick: number): LatLng {
  const phase = tick % (2 * ROUTE_STEPS);
  const f = phase <= ROUTE_STEPS ? phase / ROUTE_STEPS : (2 * ROUTE_STEPS - phase) / ROUTE_STEPS;
  return { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f };
}

/**
 * Bam's 30-tick cycle: approaches from the north (outside until tick 9),
 * inside the 200 m home zone on ticks 10–20, leaves from tick 21.
 */
export const ZONE_CYCLE_TICKS = 30;
const STEP_M = 278;
export function zoneVisitorPosition(tick: number): LatLng {
  const p = tick % ZONE_CYCLE_TICKS;
  const distanceM = STEP_M * Math.max(0, Math.abs(p - 15) - 5);
  // Small wiggle inside the zone so the pin still visibly moves (≤ 40 m).
  const wiggle = distanceM === 0 ? 0.00035 * Math.sin(p) : 0;
  return { lat: HOME_ZONE_CENTER.lat + distanceM / 111_320 + wiggle, lng: HOME_ZONE_CENTER.lng + wiggle };
}

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6_371_000, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
