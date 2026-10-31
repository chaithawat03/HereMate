// Android wiring for closed-app sharing (HereMate v2 Live only).
// TaskManager.defineTask MUST run at module load, so this module is imported by
// HereMateApp; the OS may start JS headlessly just to deliver locations.
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStagingGuestAuth } from '../../auth/firebaseGuest';
import { firebaseStagingIdentity } from '../../config/firebaseStaging';
import { APPROVED_M2_STAGING_ORIGINS, createM2StagingTransport } from '../m2StagingTransport';
import {
  BACKGROUND_STATE_KEY, BACKGROUND_STOP_KEY, BACKGROUND_TASK, LOCATION_TASK_OPTIONS, type BackgroundState, type StopRecord,
} from './backgroundPolicy';
import { createBackgroundSharing, type BgFix } from './backgroundSharing';

const auth = getStagingGuestAuth();

const transport = createM2StagingTransport({
  approvedCloudRunUrl: APPROVED_M2_STAGING_ORIGINS[1],
  projectId: firebaseStagingIdentity.projectId,
  currentIdentity: () => {
    const user = auth.currentUser;
    return user ? { uid: user.uid, getIdToken: () => user.getIdToken() } : null;
  },
  isForeground: () => AppState.currentState === 'active',
  foregroundPermissionGranted: async () => (await Location.getForegroundPermissionsAsync()).granted === true,
  useDeviceSessions: false,
  fetchImpl: fetch,
});

export const backgroundSharing = createBackgroundSharing({
  now: Date.now,
  currentUid: () => auth.currentUser?.uid ?? null,
  store: {
    load: async () => {
      const raw = await AsyncStorage.getItem(BACKGROUND_STATE_KEY);
      if (!raw) return null;
      try {
        const v = JSON.parse(raw) as BackgroundState;
        return typeof v?.ownerUid === 'string' && typeof v?.peerId === 'string' && Number.isFinite(v?.deadlineMs) ? v : null;
      } catch { return null; }
    },
    save: async s => {
      if (s) await AsyncStorage.setItem(BACKGROUND_STATE_KEY, JSON.stringify(s));
      else await AsyncStorage.removeItem(BACKGROUND_STATE_KEY);
    },
    loadStop: async () => {
      const raw = await AsyncStorage.getItem(BACKGROUND_STOP_KEY);
      if (!raw) return null;
      try {
        const v = JSON.parse(raw) as StopRecord;
        return Number.isFinite(v?.atMs) && typeof v?.reason === 'string' ? v : null;
      } catch { return null; }
    },
    saveStop: async r => {
      if (r) await AsyncStorage.setItem(BACKGROUND_STOP_KEY, JSON.stringify(r));
      else await AsyncStorage.removeItem(BACKGROUND_STOP_KEY);
    },
  },
  location: {
    requestForeground: async () => (await Location.requestForegroundPermissionsAsync()).granted === true,
    requestBackground: async () => (await Location.requestBackgroundPermissionsAsync()).granted === true,
    requestNotifications: async () => {
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never);
      }
    },
    startUpdates: async () => {
      const { accuracyName: _a, ...rest } = LOCATION_TASK_OPTIONS;
      await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
        ...rest,
        accuracy: Location.Accuracy.Balanced,
        foregroundService: { ...LOCATION_TASK_OPTIONS.foregroundService },
      });
    },
    stopUpdates: async () => {
      if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK)) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
      }
    },
    isRunning: () => Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK),
  },
  transport,
});

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BACKGROUND_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  // Headless start: wait for Firebase to restore the persisted session first.
  await auth.authStateReady();
  const fixes: BgFix[] = data.locations.map(l => ({
    latitude: l.coords.latitude, longitude: l.coords.longitude,
    accuracyMeters: l.coords.accuracy ?? Infinity, capturedAtMs: l.timestamp,
  }));
  await backgroundSharing.onLocations(fixes);
});

/** LivePorts['background'] implementation. */
export const backgroundPort = {
  start: (peerId: string, hours: 1 | 4 | 8, opts?: { beforeGrant?: () => Promise<unknown> }) =>
    backgroundSharing.start({ peerId, hours, beforeGrant: opts?.beforeGrant }),
  stop: (reason: 'user' | 'mode' | 'signout') => backgroundSharing.stop(reason),
  current: () => backgroundSharing.current(),
  subscribe: (fn: () => void) => backgroundSharing.subscribe(fn),
  lastStopped: () => backgroundSharing.lastStopped(),
};

export async function resumeBackgroundOnLaunch() {
  await auth.authStateReady();
  return backgroundSharing.resumeOnLaunch();
}
