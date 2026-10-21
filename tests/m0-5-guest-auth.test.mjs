import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const eas=JSON.parse(read('eas.json'));
const app=read('App.tsx');
const guest=read('src/auth/firebaseGuest.ts');
const gate=read('src/auth/GuestAuthGate.tsx');
const security=JSON.parse(read('security/staging-exceptions.json'));

test('existing android-preview & ios-simulator profiles remain unchanged',()=>{
  assert.equal(eas.build['android-preview'].env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST,undefined);
  assert.equal(eas.build['ios-simulator'].env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST,undefined);
  assert.equal(eas.build['android-preview'].android.buildType,'apk');
  assert.equal(eas.build['ios-simulator'].ios.simulator,true);
});
test('Guest preview requires explicit staging flag and is never a production profile',()=>{
  assert.equal(eas.build['android-guest-staging'].distribution,'internal');
  assert.equal(eas.build['android-guest-staging'].android.buildType,'apk');
  assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST,'true');
  assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENVIRONMENT,'staging');
  assert.equal(eas.build['ios-guest-simulator'].ios.simulator,true);
  assert.equal(Object.hasOwn(eas.build,'production'),false);
  assert.match(app,/return <DemoMap \/>;/);
  assert.match(app,/EXPO_PUBLIC_ENABLE_FIREBASE_GUEST !== 'true'/);
  assert.match(guest,/EXPO_PUBLIC_ENVIRONMENT !== 'staging'/);
  assert.match(guest,/assertFirebaseStagingIdentity\(\)/);
});
test('anonymous login is user-initiated, persists using React Native AsyncStorage',()=>{
  assert.match(guest,/getReactNativePersistence\(AsyncStorage\)/);
  assert.match(guest,/signInAnonymously\(auth\)/);
  assert.match(guest,/signOut\(auth\)/);
  assert.match(guest,/onAuthStateChanged/);
  assert.match(gate,/onPress={guestLogin}/);
  assert.match(gate,/onPress={logout}/);
  assert.match(gate,/user\.isAnonymous/);
  assert.match(gate,/ไม่มีการเข้าถึงตำแหน่ง GPS/);
  assert.doesNotMatch(guest+gate,/getFirestore|getDatabase|geolocation|Location\.getCurrentPosition|requestForegroundPermissions|firebase\/analytics/);
});
test('do not confuse Guest preview staging with existing synthetic exception approval',()=>{
  assert.equal(security.sourceScope,'synthetic-data-only');
  assert.match(guest,/only when staging's explicit Guest preview flag is enabled/i);
});
