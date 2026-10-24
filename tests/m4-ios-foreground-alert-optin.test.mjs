import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {shouldPresentM4ForegroundAlert} from '../src/geofences/m4ForegroundAlertPolicy.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const USER_A='m4iosowner0000000001',USER_B='m4iosowner0000000002';
const base={platform:'ios',currentUid:USER_A,panelUid:USER_A,
  appActive:true,optedIn:true,event:'enter'};

test('iOS and Android show only explicit opted-in foreground server-confirmed transitions',()=>{
  for(const platform of ['ios','android']){
    for(const event of ['enter','exit'])
      assert.equal(shouldPresentM4ForegroundAlert({...base,platform,event}),true);
  }
  for(const platform of ['web','windows','macos','unknown'])
    assert.equal(shouldPresentM4ForegroundAlert({...base,platform}),false);
  for(const event of [null,'unknown','ambiguous','stale','offline'])
    assert.equal(shouldPresentM4ForegroundAlert({...base,event}),false);
});

test('no foreground alert without a fresh exact Firebase identity match',()=>{
  for(const patch of [
    {currentUid:USER_B},{panelUid:USER_B},{currentUid:null},
    {panelUid:null},{currentUid:null,panelUid:null},
    {panelUid:''},{appActive:false},{optedIn:false}
  ]) assert.equal(shouldPresentM4ForegroundAlert({...base,...patch}),false);
});

test('iOS UI remains session-only, never registers push or background GPS',()=>{
  const ui=read('src/geofences/M4GeofencePanel.tsx');
  const policy=read('src/geofences/m4ForegroundAlertPolicy.ts');
  const staging=read('src/geofences/M4GeofenceStagingScreens.tsx');
  const eas=read('eas.json');
  const workflow=read('.github/workflows/android-m2-native-staging-apk.yml');
  assert.match(ui,/\(Platform\.OS==='android'\|\|Platform\.OS==='ios'\)\?<Pressable/);
  assert.match(ui,/shouldPresentM4ForegroundAlert\(/);
  assert.match(ui,/currentUid!==panelUid\)return/);
  assert.match(ui,/getStagingGuestAuth\(\)\.currentUser\?\.uid/);
  assert.match(ui,/alertsRef\.current=false/);
  assert.match(ui,/setForegroundAlerts\(false\)/);
  assert.match(ui,/zoneWatch\.current\?\.stop\(\)/);
  assert.match(ui,/Alert\.alert\(/);
  assert.match(staging,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES!=='true'/);
  assert.doesNotMatch(eas,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES/);
  assert.doesNotMatch(workflow,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES: 'true'/);
  for(const source of [ui,policy]){
    assert.doesNotMatch(source,/expo-notifications|scheduleNotificationAsync|registerTaskAsync|startLocationUpdatesAsync|AsyncStorage/);
  }
  assert.doesNotMatch(policy,/latitude|longitude|coordinate|locationHistory|console\.log|fetch\(/);
});
