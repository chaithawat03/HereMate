import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import App from './App';
import M2StagingApp from './M2StagingApp';
import M3IOSStagingApp from './M3IOSStagingApp';

// HereMate v2 (Demo/Live redesign) Android preview: explicit bundle-time opt-in.
const heremateV2 =
  Platform.OS === 'android' &&
  process.env.EXPO_PUBLIC_ENABLE_HEREMATE_V2 === 'true';

// A dedicated manual Android native APK sets this opt-in at BUNDLE time.
// Existing Demo / Guest EAS profiles, iOS, and Production remain unchanged.
const m2AndroidStaging =
  Platform.OS === 'android' &&
  process.env.EXPO_PUBLIC_ENVIRONMENT === 'staging' &&
  process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST === 'true' &&
  process.env.EXPO_PUBLIC_ENABLE_M1_PROFILE === 'true' &&
  process.env.EXPO_PUBLIC_ENABLE_M1_FRIENDS === 'true' &&
  process.env.EXPO_PUBLIC_ENABLE_M2_SHARING === 'true';

// M3 is opt-in on iOS ONLY, independently of the Android M2 test APK.
const m3IOSForegroundStaging =
  Platform.OS === 'ios' &&
  process.env.EXPO_PUBLIC_ENVIRONMENT === 'staging' &&
  process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST === 'true' &&
  process.env.EXPO_PUBLIC_ENABLE_M1_PROFILE === 'true' &&
  process.env.EXPO_PUBLIC_ENABLE_M1_FRIENDS === 'true' &&
  process.env.EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND === 'true';

// Lazy require: other builds never load v2 modules (Firebase, background task).
// eslint-disable-next-line @typescript-eslint/no-require-imports
registerRootComponent(heremateV2 ? require('./HereMateApp').default : m2AndroidStaging
  ? M2StagingApp
  : m3IOSForegroundStaging ? M3IOSStagingApp : App);
