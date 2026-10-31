// Background (closed-app) sharing controller with injected ports, so the rules
// are testable without Android. One friend at a time, bounded by a deadline.
import {
  clampDeadline, decideOnFailure, shouldPublish,
  type BackgroundState, type StopReason,
} from './backgroundPolicy.ts';

export type BgFix = Readonly<{ latitude: number; longitude: number; accuracyMeters: number; capturedAtMs: number }>;

export type BackgroundPorts = {
  now: () => number;
  currentUid: () => string | null;
  store: { load: () => Promise<BackgroundState | null>; save: (s: BackgroundState | null) => Promise<void> };
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
  let stopped: { atMs: number; reason: StopReason } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(fn => fn());

  async function stop(reason: StopReason, atMs = p.now()): Promise<void> {
    const state = cached ?? await p.store.load().catch(() => null);
    cached = null;
    failures = 0;
    await p.location.stopUpdates().catch(() => {});
    if (state) await Promise.resolve().then(() => p.transport.stop(state.peerId)).catch(() => {});
    await p.store.save(null).catch(() => {});
    stopped = { atMs, reason };
    notify();
  }

  return {
    current: () => (cached ? { withId: cached.peerId, deadlineMs: cached.deadlineMs } : null),
    lastStopped: () => stopped,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

    async start({ peerId, hours }: { peerId: string; hours: number }): Promise<void> {
      const owner = p.currentUid();
      if (!owner) throw Error('NOT_SIGNED_IN');
      const deadlineMs = clampDeadline(p.now(), hours);
      if (!await p.location.requestForeground()) throw Error('BACKGROUND_PERMISSION_DENIED');
      if (!await p.location.requestBackground()) throw Error('BACKGROUND_PERMISSION_DENIED');
      await p.location.requestNotifications().catch(() => {});
      // A foreground share may already hold the grant/lease for this pair.
      await p.transport.start(peerId).catch(() => {});
      await p.transport.startBackground(peerId, deadlineMs);
      cached = { ownerUid: owner, peerId, deadlineMs };
      failures = 0;
      stopped = null;
      await p.store.save(cached);
      await p.location.startUpdates();
      notify();
    },

    stop,

    /** Called by the OS task with new fixes (possibly while the app is closed). */
    async onLocations(fixes: readonly BgFix[]): Promise<void> {
      const state = cached ?? await p.store.load().catch(() => null);
      if (!state) { await p.location.stopUpdates().catch(() => {}); return; }
      cached = state;
      if (p.currentUid() !== state.ownerUid) { await stop('signout'); return; }
      if (!shouldPublish({ deadlineMs: state.deadlineMs, stopped: false }, p.now())) { await stop('deadline'); return; }
      const newest = [...fixes].sort((a, b) => b.capturedAtMs - a.capturedAtMs)[0];
      if (!newest) return;
      try {
        await p.transport.publishBackground(state.peerId, newest);
        failures = 0;
      } catch {
        failures += 1;
        if (decideOnFailure(failures) === 'stop') await stop('revoked');
      }
    },

    /** On app launch: never resume an expired or other-account share; restart a killed valid one. */
    async resumeOnLaunch(): Promise<'running' | 'expired' | 'none'> {
      const state = await p.store.load().catch(() => null);
      if (!state || state.ownerUid !== p.currentUid()) {
        if (await p.location.isRunning().catch(() => false)) await p.location.stopUpdates().catch(() => {});
        if (state) await p.store.save(null).catch(() => {});
        return 'none';
      }
      if (p.now() >= state.deadlineMs) {
        cached = state;
        await stop('deadline', state.deadlineMs);
        return 'expired';
      }
      cached = state;
      if (!await p.location.isRunning().catch(() => false)) await p.location.startUpdates();
      notify();
      return 'running';
    },
  };
}
