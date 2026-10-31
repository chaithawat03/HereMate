import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createModeController, type SwitchResult } from './modeController.ts';
import type { HereMateDataSource, Mode } from './types.ts';

export const MODE_STORAGE_KEY = 'heremate.v2.mode';

type HereMateContext = {
  source: HereMateDataSource;
  mode: Mode;
  switchTo: (mode: Mode) => Promise<SwitchResult>;
};

const Ctx = createContext<HereMateContext | null>(null);

export function ModeProvider({ makeDemo, makeLive, children, fallback = null }: {
  makeDemo: () => HereMateDataSource;
  makeLive: () => HereMateDataSource;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const controller = useMemo(() => createModeController<HereMateDataSource>({
    makeDemo, makeLive,
    load: async () => {
      try {
        const v = await AsyncStorage.getItem(MODE_STORAGE_KEY);
        return v === 'live' || v === 'demo' ? v : null;
      } catch { return null; }
    },
    save: async mode => { try { await AsyncStorage.setItem(MODE_STORAGE_KEY, mode); } catch { /* best effort */ } },
  }), [makeDemo, makeLive]);
  const [source, setSource] = useState<HereMateDataSource | null>(null);
  // A new key per source remounts the UI, so no state from the previous mode is painted.
  const [sourceKey, setSourceKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const unsub = controller.subscribe(s => { if (alive) { setSource(s); setSourceKey(k => k + 1); } });
    controller.init().then(() => { if (alive) setSource(controller.active()); });
    return () => {
      alive = false;
      unsub();
      // Activity destroyed / UI unmounted: release timers and polling only.
      // Background (closed-app) sharing must keep running until its deadline or an explicit stop.
      controller.dispose();
    };
  }, [controller]);

  const value = useMemo(() => (source
    ? { source, mode: source.mode, switchTo: (m: Mode) => controller.switchTo(m) }
    : null), [source, controller]);

  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}><React.Fragment key={sourceKey}>{children}</React.Fragment></Ctx.Provider>;
}

export function useHereMate(): HereMateContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw Error('useHereMate must be used inside ModeProvider');
  return ctx;
}
