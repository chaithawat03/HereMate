import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bindVerifiedForegroundWatch} from '../src/location/androidForegroundWatchBind.ts';

const makeDeferred=()=>{
 let release;
 const promise=new Promise(resolve=>{release=resolve;});
 return {release,promise};
};
test('Android late native watcher is removed if foreground permission was revoked mid-bind',async()=>{
 const wait=makeDeferred();let allowed=true,removed=0,checks=0;
 const pending=bindVerifiedForegroundWatch(
   async()=>{await wait.promise;return {remove:()=>{removed++;}};},
   async()=>{checks++;return allowed;}
 );
 allowed=false;wait.release();
 await assert.rejects(pending,/ANDROID_FOREGROUND_WATCH_REVOKED_DURING_BIND/);
 assert.equal(removed,1);
 assert.equal(checks,1);
});
test('Android late watcher is removed after Firebase UID switch or background',async()=>{
 for(const cause of ['auth','background']){
   const wait=makeDeferred();let uid='originalowner00001',foreground=true,removed=0;
   const pending=bindVerifiedForegroundWatch(
     async()=>{await wait.promise;return {remove:()=>{removed++;}};},
     async()=>uid==='originalowner00001'&&foreground
   );
   if(cause==='auth')uid='secondowner000002';
   else foreground=false;
   wait.release();
   await assert.rejects(pending,/REVOKED_DURING_BIND/);
   assert.equal(removed,1);
 }
});
test('OS permission API exception fails closed and removes GPS watcher',async()=>{
 let removed=0;
 await assert.rejects(bindVerifiedForegroundWatch(
   async()=>({remove:()=>{removed++;}}),
   async()=>{throw Error('Settings permission service failure');}
 ),/REVOKED_DURING_BIND/);
 assert.equal(removed,1);
});
test('valid foreground subscription is retained until caller removes it',async()=>{
 let removed=0;
 const sub=await bindVerifiedForegroundWatch(
   async()=>({remove:()=>{removed++;}}),
   async()=>true
 );
 assert.equal(removed,0);
 sub.remove();assert.equal(removed,1);
});
test('native binding rejection is propagated without claiming watcher exists',async()=>{
 let checks=0;
 await assert.rejects(bindVerifiedForegroundWatch(
   async()=>{throw Error('Android native GPS unavailable');},
   async()=>{checks++;return true;}
 ),/native GPS unavailable/);
 assert.equal(checks,0);
});
test('M2 Android source verifies actual Firebase account and OS permission after await',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const panel=read('src/location/M2SharingPanel.tsx');
 const transport=read('src/location/m2StagingTransport.ts');
 const manifest=JSON.parse(read('app.json'));
 assert.match(panel,/bindVerifiedForegroundWatch\(/);
 assert.match(panel,/actor=auth\.currentUser\?\.uid\?\?null/);
 assert.match(panel,/actor===account\.current&&auth\.currentUser\?\.uid===actor/);
 assert.match(panel,/await Location\.hasServicesEnabledAsync\(\)/);
 assert.match(panel,/getForegroundPermissionsAsync\(\)/);
 assert.match(panel,/watching=false;subscription\.remove\(\)/);
 assert.match(transport,/foregroundPermissionGranted/);
 assert.equal(manifest.expo.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-location')[1].isAndroidBackgroundLocationEnabled,false);
 assert.doesNotMatch(panel,/startLocationUpdatesAsync|requestBackgroundPermissionsAsync|TaskManager|AsyncStorage/);
});
