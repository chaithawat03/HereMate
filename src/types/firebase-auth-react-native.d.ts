/**
 * Firebase Auth React Native TS typing bridge, scoped to Expo-native builds.
 *
 * Firebase JS SDK `firebase/auth` exposes the React Native persistence
 * implementation at runtime via Metro's React Native entry, but its default
 * TypeScript declarations use the Web entry and omit this export.
 *
 * This declaration ONLY describes Firebase's documented native API:
 * https://firebase.google.com/docs/reference/js/auth#function_getreactnativepersistence
 *
 * IMPORTANT: Do not use a broad `any` cast, a deep SDK import, or disable
 * TypeScript verification. Remove this file if an upgraded Firebase SDK
 * exports the correct React Native type without the bridge.
 */
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }): Persistence;
}
