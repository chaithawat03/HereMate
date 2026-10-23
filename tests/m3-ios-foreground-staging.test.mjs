import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const index=read('index.ts'),app=read('M3IOSStagingApp.tsx'),
  panels=read('src/location/M3IOSStagingScreens.tsx');
const eas=JSON.parse(read('eas.json'));

test('M3 iOS has distinct explicit opt-in and preserves Android existing root',()=>{
 assert.match(index,/Platform.OS === 'ios'/);
 assert.match(index,/EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND === 'true'/);
 assert.match(index,/m3IOSForegroundStaging \? M3IOSStagingApp : App/);
 assert.match(index,/m2AndroidStaging[\s\S]*?\? M2StagingApp/);
 assert.match(app,/GuestAuthGate/);
 assert.match(app,/FriendsPanel/);
 assert.match(app,/UserProfilePanel/);
 assert.match(app,/M3IOSStagingScreens/);
 assert.match(app,/https:\/\/heremate-m2-location-staging-2inhowyo2a-as\.a\.run\.app/);
 assert.match(panels,/Platform.OS!=='ios'/);
 assert.match(panels,/!backendReviewedAndEnabled/);
 assert.match(panels,/getStagingGuestAuth\(\)\.currentUser/);
 assert.match(panels,/getForegroundPermissionsAsync/);
 assert.match(panels,/AppState.currentState==='active'/);
 assert.match(panels,/createM2StagingTransport/);
});
test('M3 does not request background location, use GPS history or turn on iOS in EAS',()=>{
 const source=(index+app+panels)
   .replace(/\/\*[\s\S]*?\*\//g,'')
   .replace(/^\s*\/\/.*$/gm,'');
 assert.doesNotMatch(source,
   /requestBackgroundPermissionsAsync|startLocationUpdatesAsync|TaskManager|AsyncStorage|sendPushNotification/);
 assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND,undefined);
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND,undefined);
 assert.doesNotMatch(read('App.tsx'),/M3IOSStagingApp|M3IOSStagingScreens/);
 const config=JSON.parse(read('app.json'));
 const plugin=config.expo.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-location');
 assert.equal(plugin[1].isIosBackgroundLocationEnabled,false);
 assert.equal(plugin[1].isAndroidBackgroundLocationEnabled,false);
});
