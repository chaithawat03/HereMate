// Dynamic Expo config. Without EXPO_PUBLIC_ENABLE_HEREMATE_V2=true the static
// app.json is returned UNCHANGED, so every existing build (Demo/Guest EAS, M2
// Android staging, M3 iOS) keeps background location disabled.
// Only the HereMate v2 Android preview opts into the closed-app (background)
// location sharing permissions and the MapLibre native map.
const V2_ANDROID_PERMISSIONS = [
  'ACCESS_COARSE_LOCATION',
  'ACCESS_FINE_LOCATION',
  'ACCESS_BACKGROUND_LOCATION',
  'FOREGROUND_SERVICE',
  'FOREGROUND_SERVICE_LOCATION',
  'POST_NOTIFICATIONS',
];

module.exports = ({ config }) => {
  if (process.env.EXPO_PUBLIC_ENABLE_HEREMATE_V2 !== 'true') return config;
  const next = structuredClone(config);
  next.plugins = next.plugins.map(plugin =>
    Array.isArray(plugin) && plugin[0] === 'expo-location'
      ? ['expo-location', {
          ...plugin[1],
          locationWhenInUsePermission: 'Allow HereMate to show your position and share it with friends you choose.',
          locationAlwaysAndWhenInUsePermission: 'Allow HereMate to keep sharing with the friend you chose while the app is closed, until the timer you set ends.',
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
          isIosBackgroundLocationEnabled: false,
        }]
      : plugin);
  next.plugins.push('@maplibre/maplibre-react-native');
  next.android = {
    ...next.android,
    permissions: [...new Set([...(next.android.permissions || []), ...V2_ANDROID_PERMISSIONS])],
  };
  return next;
};
