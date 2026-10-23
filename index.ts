import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import App from './App';
import M2StagingApp from './M2StagingApp';

// A dedicated manual Android native APK sets this opt-in at BUNDLE time.
// Existing Demo / Guest EAS profiles, iOS, and Production remain unchanged.
const m2AndroidStaging =
  Platform.OS === 'android' &&
  process.env.EXPO_PUBLIC_ENVIRONMENT === 'staging' &&
  process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST === 'true' &&
  process.env.EXPO_PUBLIC_ENABLE_M1_PROFILE === 'true' &&
  process.env.EXPO_PUBLIC_ENABLE_M1_FRIENDS === 'true' &&
  process.env.EXPO_PUBLIC_ENABLE_M2_SHARING === 'true';

registerRootComponent(m2AndroidStaging ? M2StagingApp : App);
