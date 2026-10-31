import React, { useCallback, useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as Location from 'expo-location';
import { PreferencesProvider } from './src/ui/PreferencesProvider';
import { ModeProvider } from './src/data/ModeProvider';
import { createDemoDataSource } from './src/data/demo/demoDataSource';
import { createLiveDataSource } from './src/data/live/liveDataSource';
import { createLivePorts } from './src/data/live/liveWiring';
// Importing defines the Android background location task at module load.
import { backgroundPort, resumeBackgroundOnLaunch } from './src/location/background/backgroundTask';
import { Shell } from './src/app/Shell';

// HereMate v2 root (Android preview): Demo/Live modes over one data interface.
export default function HereMateApp() {
  const makeDemo = useCallback(() => createDemoDataSource({
    now: Date.now,
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: h => clearInterval(h as ReturnType<typeof setInterval>),
    myGps: async () => {
      try {
        if (!(await Location.getForegroundPermissionsAsync()).granted) return null;
        const last = await Location.getLastKnownPositionAsync();
        return last ? { lat: last.coords.latitude, lng: last.coords.longitude } : null;
      } catch { return null; }
    },
  }), []);
  const makeLive = useCallback(() => createLiveDataSource(createLivePorts(backgroundPort)), []);
  // Never resume an expired or other-account background share; restart a valid one killed by the OS.
  useEffect(() => { void resumeBackgroundOnLaunch().catch(() => {}); }, []);
  return (
    <PreferencesProvider>
      <ModeProvider makeDemo={makeDemo} makeLive={makeLive}
        fallback={<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF1F4' }}><ActivityIndicator /></View>}>
        <Shell />
      </ModeProvider>
    </PreferencesProvider>
  );
}
