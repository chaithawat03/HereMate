/**
 * HereMate Firebase JS SDK staging configuration (PUBLIC application identifiers).
 *
 * This module deliberately does not initialize the SDK or access a backend.
 * It can be imported when M0.5 Auth/Rules gates are approved.
 *
 * The Firebase web app provides the Firebase JS SDK config for Native Expo;
 * this does NOT create a website, require Hosting, or request Analytics.
 *
 * Firebase API keys are not OAuth credentials: authorization belongs to
 * Firebase Auth and server-verified Firestore/RTDB Security Rules.
 */
export const firebaseStagingIdentity = Object.freeze({
  projectId: 'heremate',
  projectNumber: '976775896533',
  androidPackageName: 'com.chaithawat03.heremate',
  androidAppId: '1:976775896533:android:a34f7f3aa147c2bcaa315c',
  webAppId: '1:976775896533:web:c71784a039e43386aa315c',
} as const);

export const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyAIA-R2iVAFCA7MvR84eZRgvt1b-HnmJBw',
  authDomain: 'heremate.firebaseapp.com',
  projectId: 'heremate',
  storageBucket: 'heremate.firebasestorage.app',
  messagingSenderId: '976775896533',
  appId: '1:976775896533:web:c71784a039e43386aa315c',
} as const);

/**
 * Call before initializing Firebase JS SDK in a future Auth milestone.
 * Never accept arbitrary project IDs from CI inputs or user-provided URLs.
 */
export function assertFirebaseStagingIdentity(
  config: Readonly<{
    projectId: string;
    messagingSenderId: string;
    appId: string;
    authDomain: string;
    storageBucket: string;
    apiKey: string;
  }> = firebaseConfig,
): void {
  if (
    config.projectId !== firebaseStagingIdentity.projectId ||
    config.messagingSenderId !== firebaseStagingIdentity.projectNumber ||
    config.appId !== firebaseStagingIdentity.webAppId ||
    config.authDomain !== 'heremate.firebaseapp.com' ||
    config.storageBucket !== 'heremate.firebasestorage.app' ||
    !config.apiKey.startsWith('AIza')
  ) {
    throw new Error('FIREBASE_STAGING_BLOCKED: Firebase JS SDK project/app identity mismatch');
  }
}
