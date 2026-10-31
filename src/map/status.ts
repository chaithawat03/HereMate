import type { FriendStatus, LatLng } from '../data/types.ts';

const RING: Record<FriendStatus, string> = {
  LIVE: '#2FB57C', STALE: '#C9A34A', OFFLINE: '#A0AAB4', SHARING_OFF: '#A0AAB4',
};
export function ringColor(status: FriendStatus): string { return RING[status]; }

export function ageLabel(ageMs: number, lang: 'th' | 'en'): string {
  if (!Number.isFinite(ageMs)) return '';
  if (ageMs < 60_000) return lang === 'th' ? 'ตอนนี้' : 'now';
  if (ageMs < 3_600_000) {
    const m = Math.floor(ageMs / 60_000);
    return lang === 'th' ? `${m} นาทีที่แล้ว` : `${m} min ago`;
  }
  if (ageMs < 48 * 3_600_000) {
    const h = Math.floor(ageMs / 3_600_000);
    return lang === 'th' ? `${h} ชม.ที่แล้ว` : `${h} h ago`;
  }
  const d = Math.floor(ageMs / 86_400_000);
  return lang === 'th' ? `${d} วันที่แล้ว` : `${d} d ago`;
}

export function distanceLabel(meters: number, lang: 'th' | 'en'): string {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters / 10) * 10} ${lang === 'th' ? 'ม.' : 'm'}`;
  return `${(meters / 1000).toFixed(1)} ${lang === 'th' ? 'กม.' : 'km'}`;
}

/** Closed ring of [lng, lat] points at `radiusM` around `center` (spherical destination formula). */
export function circlePolygon(center: LatLng, radiusM: number, steps = 48): [number, number][] {
  const R = 6_371_000, d = radiusM / R;
  const lat1 = center.lat * Math.PI / 180, lng1 = center.lng * Math.PI / 180;
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const brg = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lng2 = lng1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([lng2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
  }
  ring.push(ring[0]);
  return ring;
}
