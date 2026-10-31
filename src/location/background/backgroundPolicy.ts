// Pure rules for closed-app (background) sharing. Live mode only.
export const BACKGROUND_TASK = 'heremate.background-location';
export const BACKGROUND_STATE_KEY = 'heremate.v2.background';
export const HOUR_MS = 3_600_000;
/** Server-side grant lapses after ~60 s; ~4 failed 30 s publishes ≈ 2 minutes. */
export const MAX_CONSECUTIVE_FAILURES = 4;

export type BackgroundState = Readonly<{ ownerUid: string; peerId: string; deadlineMs: number }>;
export type StopReason = 'user' | 'deadline' | 'revoked' | 'signout' | 'mode';

export function clampDeadline(now: number, hours: number): number {
  if (hours !== 1 && hours !== 4 && hours !== 8) throw Error('INVALID_BACKGROUND_HOURS');
  return now + hours * HOUR_MS;
}

export function shouldPublish(state: { deadlineMs: number; stopped: boolean }, now: number): boolean {
  return !state.stopped && Number.isFinite(state.deadlineMs) && now < state.deadlineMs;
}

/**
 * The staging transport reports every failure (network or server denial) as the same
 * error, so revocation is detected by repeated failure and the share fails closed.
 */
export function decideOnFailure(consecutiveFailures: number): 'retry' | 'stop' {
  return consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? 'stop' : 'retry';
}

export const LOCATION_TASK_OPTIONS = Object.freeze({
  accuracyName: 'Balanced' as const,
  distanceInterval: 25,
  timeInterval: 30000,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: Object.freeze({
    notificationTitle: 'HereMate กำลังแชร์ตำแหน่ง',
    notificationBody: 'แตะเพื่อเปิดแอปและหยุดแชร์',
    killServiceOnDestroy: false,
  }),
});
