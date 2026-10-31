// Pure rules for closed-app (background) sharing. Live mode only.
export const BACKGROUND_TASK = 'heremate.background-location';
export const BACKGROUND_STATE_KEY = 'heremate.v2.background';
export const BACKGROUND_STOP_KEY = 'heremate.v2.background-stop';
export const HOUR_MS = 3_600_000;
/** Background grant window is 120 s and fixes come every ~20 s, so 4 failures ≈ the window. */
export const MAX_CONSECUTIVE_FAILURES = 4;
/** The server rejects fixes older than 30 s; JobScheduler may deliver late, so skip those locally. */
export const MAX_FIX_PUBLISH_AGE_MS = 25_000;

export type BackgroundState = Readonly<{ ownerUid: string; peerId: string; deadlineMs: number }>;
export type StopReason = 'user' | 'deadline' | 'revoked' | 'signout' | 'mode';
export type StopRecord = Readonly<{ atMs: number; reason: StopReason }>;

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
  // Time-based heartbeat: a stationary phone must still renew the 2-minute grant.
  distanceInterval: 0,
  timeInterval: 20000,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  foregroundService: Object.freeze({
    notificationTitle: 'HereMate กำลังแชร์ตำแหน่ง',
    notificationBody: 'แตะเพื่อเปิดแอปและหยุดแชร์',
    killServiceOnDestroy: false,
  }),
});
