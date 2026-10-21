/**
 * HereMate M0.5.3 — Native Android/iOS Guest Auth (staging only).
 * Firebase JS SDK module. NO Firestore/RTDB reads, Maps or location access.
 *
 * This is imported only when staging's explicit Guest preview flag is enabled.
 * Firebase Auth tokens persist in AsyncStorage; AsyncStorage is NOT encrypted.
 */
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  onAuthStateChanged,
  signInAnonymously,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { assertFirebaseStagingIdentity, firebaseConfig } from '../config/firebaseStaging';

let authInstance: Auth | undefined;

export function getStagingGuestAuth(): Auth {
  // A URL or runtime input must NEVER choose a different Firebase project.
  assertFirebaseStagingIdentity();
  if (process.env.EXPO_PUBLIC_ENVIRONMENT !== 'staging' ||
      process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST !== 'true') {
    throw new Error('Guest Auth is disabled outside explicit staging preview');
  }
  if (authInstance) return authInstance;

  const existing = getApps();
  if (existing.some(app => app.options.projectId !== firebaseConfig.projectId)) {
    throw new Error('FIREBASE_STAGING_BLOCKED: unexpected initialized Firebase app');
  }
  const app = existing.length ? getApp() : initializeApp(firebaseConfig);

  // AsyncStorage v2 uses the default export (v3 uses createAsyncStorage).\n  // Per-app installation-scoped persistent login: no implicit account creation
  // and no manual copying Firebase refresh/ID tokens into our own storage.
  try {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch (error) {
    // Hot reload can re-evaluate this module after Firebase Auth was initialized.
    // No Firebase Auth instance may be initialized elsewhere in this app.
    if ((error as { code?: string } | null)?.code !== 'auth/already-initialized') throw error;
    authInstance = getAuth(app);
  }
  return authInstance;
}

export const watchGuestSession = (
  auth: Auth,
  changed: (user: User | null) => void,
  failure: (error: Error) => void,
) => onAuthStateChanged(auth, changed, failure);

export const startGuestSession = (auth: Auth) => signInAnonymously(auth);
export const stopGuestSession = (auth: Auth) => signOut(auth);
