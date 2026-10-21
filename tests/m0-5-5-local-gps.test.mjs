import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toLocalSample } from '../src/location/locationLogic.ts';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = read('App.tsx');
const panel = read('src/location/LocalLocationPanel.tsx');
const config = JSON.parse(read('app.json'));
const eas = JSON.parse(read('eas.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
test('validates and rounds local-only synthetic test fixes', () => {
  assert.deepEqual(toLocalSample({timestamp: 1500000000000, coords: {latitude:13.12345678,longitude:100.98765432,accuracy:11.8}}),
    {latitude:13.123457,longitude:100.987654,accuracyMeters:12,measuredAt:1500000000000});
  for(const [latitude,longitude] of [[91,0],[-91,0],[0,181],[0,-181],[NaN,0],[Infinity,1]])
    assert.equal(toLocalSample({timestamp:1500000000000,coords:{latitude,longitude}}),null);
  assert.equal(toLocalSample({timestamp:-1,coords:{latitude:0,longitude:0}}),null);
});
test('Expo SDK 57 native location module is exact locked', () => {
  assert.equal(pkg.dependencies['expo-location'],'57.0.12');
  assert.equal(lock.packages[''].dependencies['expo-location'],'57.0.12');
  assert.equal(lock.packages['node_modules/expo-location'].version,'57.0.12');
  assert.ok(lock.packages['node_modules/@expo/image-utils']);
});
test('foreground permission is user initiated and no remote GPS or background tracking exists', () => {
  const options=config.expo.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-location')?.[1];
  assert.equal(options.isAndroidBackgroundLocationEnabled,false);
  assert.equal(options.isIosBackgroundLocationEnabled,false);
  assert.equal(options.isAndroidForegroundServiceEnabled,false);
  assert.ok(options.locationWhenInUsePermission);
  assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_LOCAL_GPS,'true');
  assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_LOCAL_GPS,'true');
  assert.equal(eas.build['android-preview'].env.EXPO_PUBLIC_ENABLE_LOCAL_GPS,undefined);
  assert.match(app,/EXPO_PUBLIC_ENABLE_LOCAL_GPS === 'true'/);
  assert.match(app,/<LocalLocationPanel \/>/);
  assert.match(panel,/requestForegroundPermissionsAsync/);
  assert.match(panel,/watchPositionAsync/);
  assert.match(panel,/AppState\.addEventListener/);
  assert.match(panel,/watchRef\.current\?\.remove\(\)/);
  assert.doesNotMatch(panel+app,/startLocationUpdatesAsync|requestBackgroundPermissionsAsync|getFirestore|getDatabase|setDoc|updateDoc|setValue/);
  assert.match(panel,/ไม่ส่ง Firebase/);
});
