// Background (closed-app) sharing controller with injected ports, so the rules
// are testable without Android. One friend at a time, bounded by a deadline.
import {
  clampDeadline, decideOnFailure, shouldPublish, MAX_FIX_PUBLISH_AGE_MS,
  type BackgroundState, type StopReason, type StopRecord,
} from './backgroundPolicy.ts';

export type BgFix = Readonly<{ latitude: number; longitude: number; accuracyMeters: number; capturedAtMs: number }>;

export type BackgroundPorts = {
  now: () => number;
  currentUid: () => string | null;
  store: {
    load: () => Promise<BackgroundState | null>;
    save: (s: BackgroundState | null) => Promise<void>;
    loadStop: () => Promise<StopRecord | null>;
    saveStop: (r: StopRecord | null) => Promise<void>;
  };
  location: {
    requestForeground: () => Promise<boolean>;
    requestBackground: () => Promise<boolean>;
    requestNotifications: () => Promise<void>;
    startUpdates: () => Promise<void>;
    stopUpdates: () => Promise<void>;
    isRunning: () => Promise<boolean>;
  };
  transport: {
    start: (peerUid: string) => Promise<unknown>;
    startBackground: (peerUid: string, deadlineMs: number) => Promise<unknown>;
    publishBackground: (peerUid: string, fix: BgFix) => Promise<unknown>;
    stop: (peerUid: string) => Promise<unknown>;
  };
};

export function createBackgroundSharing(p: BackgroundPorts) {
  let cached: BackgroundState | null = null;
  let failures = 0;
  let stopped: StopRecord | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(fn => fn());

  /**
   * Ends sharing. `remote` false = local-only (another Firebase account is signed in now,
   * so a STOP would be sent with the wrong identity; the old grant lapses within 2 minutes).
   */
  async function stop(reason: StopReason, atMs = p.now(), remote = true): Promise<void> {
    const state = cached ?? await p.store.load().catch(() => null);
    cached = null;
    failures = 0;
    await p.location.stopUpdates().catch(() => {});
    if (state && remote) await Promise.resolve().then(() => p.transport.stop(state.peerId)).catch(() => {});
    await p.store.save(null).catch(() => {});
    stopped = { atMs, reason };
    await p.store.saveStop(stopped).catch(() => {});
    notify();
  }

  /** Grant (may already exist from foreground sharing) + background block for the deadline. */
  async function establish(peerId: string, deadlineMs: number) {
    await p.transport.start(peerId).catch(() => {});
    await p.transport.startBackground(peerId, deadlineMs);
  }

  return {
    current: () => (cached ? { withId: cached.peerId, deadlineMs: cached.deadlineMs } : null),
    lastStopped: () => stopped,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    async start({ peerId, hours, beforeGrant }: { peerId: string; hours: number; beforeGrant?: () => Promise<unknown> }): Promise<void> {
      const owner = p.currentUid();
      if (!owner) throw Error('NOT_SIGNED_IN');
      const deadlineMs = clampDeadline(p.now(), hours);
      if (!await p.location.requestForeground()) throw Error('BACKGROUND_PERMISSION_DENIED');
      if (!await p.location.requestBackground()) throw Error('BACKGROUND_PERMISSION_DENIED');
      await p.location.requestNotifications().catch(() => {});
      // Only now (permissions granted) may the caller hand over its foreground share.
      if (beforeGrant) await beforeGrant();
      await establish(peerId, deadlineMs);
      cached = { ownerUid: owner, peerId, deadlineMs };
      failures = 0;
      try {
        await p.store.save(cached);
        await p.location.startUpdates();
      } catch (e) {
        await stop('user'); // no phantom "active" state; roll back the server share
        throw e;
      }
      stopped = null;
      await p.store.saveStop(null).catch(() => {});
      notify();
    },

    stop: (reason: StopReason) => stop(reason),

    /** Called by the OS task with new fixes (possibly while the app is closed). */
    async onLocations(fixes: readonly BgFix[]): Promise<void> {
      const state = cached ?? await p.store.load().catch(() => null);
      if (!state) { await p.location.stopUpdates().catch(() => {}); return; }
      cached = state;
      if (p.currentUid() !== state.ownerUid) { await stop('signout', p.now(), false); return; }
      if (!shouldPublish({ deadlineMs: state.deadlineMs, stopped: false }, p.now())) { await stop('deadline'); return; }
      const newest = [...fixes].sort((a, b) => b.capturedAtMs - a.capturedAtMs)[0];
      if (!newest || p.now() - newest.capturedAtMs > MAX_FIX_PUBLISH_AGE_MS) return; // late delivery
      try {
        await p.transport.publishBackground(state.peerId, newest);
        failures = 0;
      } catch {
        failures += 1;
        if (decideOnFailure(failures) === 'stop') await stop('revoked');
      }
    },

    /**
     * On app launch (foreground): never resume an expired or other-account share. A valid share
     * is re-established on the server for its remaining deadline, then updates are (re)started.
     */
    async resumeOnLaunch(): Promise<'running' | 'expired' | 'stopped' | 'none'> {
      stopped = await p.store.loadStop().catch(() => null);
      const state = await p.store.load().catch(() => null);
      if (!state || state.ownerUid !== p.currentUid()) {
        if (await p.location.isRunning().catch(() => false)) await p.location.stopUpdates().catch(() => {});
        if (state) await p.store.save(null).catch(() => {});
        notify();
        return 'none';
      }
      if (p.now() >= state.deadlineMs) {
        cached = state;
        await stop('deadline', state.deadlineMs);
        return 'expired';
      }
      cached = state;
      try {
        await establish(state.peerId, state.deadlineMs);
      } catch {
        await stop('revoked');
        return 'stopped';
      }
      try {
        if (!await p.location.isRunning().catch(() => false)) await p.location.startUpdates();
      } catch {
        await stop('user');
        return 'stopped';
      }
      notify();
      return 'running';
    },
  };
}
