// Owns the active data source. Every switch stops ALL sharing, background
// tasks and polling on the old source BEFORE the new source becomes visible,
// so demo and real data/location can never run at the same time.
import type { HereMateDataSource, Mode } from './types.ts';

export const MODE_STOP_TIMEOUT_MS = 5000;

type StoppableSource = Pick<HereMateDataSource, 'mode' | 'dispose'> & {
  session: Pick<HereMateDataSource['session'], 'current'>;
  location: Pick<HereMateDataSource['location'], 'stopAll'>;
};

export type ModePorts<S extends StoppableSource> = {
  makeDemo: () => S;
  makeLive: () => S;
  load: () => Promise<Mode | null>;
  save: (mode: Mode) => Promise<void>;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type SwitchResult = { mode: Mode; needsSignIn: boolean; stopTimedOut: boolean };

export function createModeController<S extends StoppableSource>(ports: ModePorts<S>) {
  const setT = ports.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = ports.clearTimeout ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));
  let source: S | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<(s: S) => void>();
  const make = (mode: Mode) => (mode === 'live' ? ports.makeLive() : ports.makeDemo());

  /** Resolves true when stopAll finished in time, false on timeout or error. */
  function stopWithin(old: S): Promise<boolean> {
    return new Promise(resolve => {
      let done = false;
      const handle = setT(() => { if (!done) { done = true; resolve(false); } }, MODE_STOP_TIMEOUT_MS);
      old.location.stopAll().then(
        () => { if (!done) { done = true; clearT(handle); resolve(true); } },
        () => { if (!done) { done = true; clearT(handle); resolve(false); } },
      );
    });
  }

  async function doSwitch(mode: Mode): Promise<SwitchResult> {
    if (!source) throw Error('MODE_NOT_INITIALISED');
    if (source.mode === mode) {
      return { mode, needsSignIn: mode === 'live' && source.session.current() === null, stopTimedOut: false };
    }
    const old = source;
    const stoppedInTime = await stopWithin(old);
    try { old.dispose(); } catch { /* best effort */ }
    source = make(mode);
    await ports.save(mode).catch(() => {});
    listeners.forEach(fn => fn(source as S));
    return { mode, needsSignIn: mode === 'live' && source.session.current() === null, stopTimedOut: !stoppedInTime };
  }

  return {
    active(): S {
      if (!source) throw Error('MODE_NOT_INITIALISED');
      return source;
    },
    async init(): Promise<Mode> {
      const saved = await ports.load().catch(() => null);
      const mode: Mode = saved === 'live' ? 'live' : 'demo';
      source = make(mode);
      return mode;
    },
    switchTo(mode: Mode): Promise<SwitchResult> {
      const run = queue.then(() => doSwitch(mode));
      queue = run.catch(() => {});
      return run;
    },
    /** UI unmount: release the active source without stopping (background) sharing. */
    dispose(): void {
      try { source?.dispose(); } catch { /* best effort */ }
    },
    subscribe(fn: (s: S) => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
  };
}
