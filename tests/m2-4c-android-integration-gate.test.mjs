import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('M2.4C Android app integration seam is dormant, Staging-only and does not enable EAS',()=>{
 const app=read('App.tsx');
 const root=read('src/location/M2AndroidStagingScreens.tsx');
 const eas=JSON.parse(read('eas.json'));
 assert.doesNotMatch(app,/M2AndroidStagingScreens|M2SharingPanel|M2FriendLocationPanel/);
 assert.ok(root.includes("Platform.OS!=='android'"));
 assert.ok(root.includes("process.env.EXPO_PUBLIC_ENVIRONMENT!=='staging'"));
 assert.ok(root.includes("process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST!=='true'"));
 assert.ok(root.includes("!backendReviewedAndEnabled"));
 assert.ok(root.includes("getStagingGuestAuth().currentUser"));
 assert.ok(root.includes("Location.getForegroundPermissionsAsync()"));
 assert.ok(root.includes("createM2StagingTransport("));
 assert.doesNotMatch(root,/https:\/\/[A-Za-z]|requestBackgroundPermissionsAsync|startLocationUpdatesAsync|AsyncStorage/);
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M2_SHARING,undefined);
 assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_M2_SHARING,undefined);
});
