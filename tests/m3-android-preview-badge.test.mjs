import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('M3 preview badge is explicit, leaving the original M2 app badge intact',()=>{
 const app=read('M2StagingApp.tsx'),m2=read('.github/workflows/android-m2-native-staging-apk.yml');
 const m3=read('.github/workflows/android-m3-foreground-preview-apk.yml');
 const index=read('index.ts'),eas=JSON.parse(read('eas.json'));
 assert.match(app,/process\.env\.EXPO_PUBLIC_ENABLE_M3_FOREGROUND_PREVIEW==='true'/);
 assert.match(app,/ANDROID · M3 FOREGROUND PREVIEW/);
 assert.match(app,/ANDROID · M2 STAGING/);
 assert.match(index,/m2AndroidStaging[\s\S]*?\? M2StagingApp/);
 assert.match(m3,/EXPO_PUBLIC_ENABLE_M3_FOREGROUND_PREVIEW: 'true'/);
 assert.match(m3,/M3-foreground-preview-only-not-M3-final/);
 assert.doesNotMatch(m2,/EXPO_PUBLIC_ENABLE_M3_FOREGROUND_PREVIEW/);
 for(const config of Object.values(eas.build))
   assert.notEqual(config.env?.EXPO_PUBLIC_ENABLE_M3_FOREGROUND_PREVIEW,'true');
});

test('visible M3 badge does not silently turn on unapproved M3 backend or background tracking',()=>{
 const m3=read('.github/workflows/android-m3-foreground-preview-apk.yml');
 const android=read('src/location/M2AndroidStagingScreens.tsx');
 const config=JSON.parse(read('app.json'));
 const gps=config.expo.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-location');
 assert.equal(gps[1].isAndroidBackgroundLocationEnabled,false);
 assert.equal(gps[1].isAndroidForegroundServiceEnabled,false);
 assert.match(m3,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS: 'false'/);
 assert.match(android,/useDeviceSessions:process\.env\.EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS==='true'/);
 assert.doesNotMatch(m3,/gcloud run deploy|firebase deploy|GOOGLE_DRIVE_REFRESH_TOKEN|secrets\./);
});
