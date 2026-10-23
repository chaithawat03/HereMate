import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('M4 Android alerts require explicit in-memory opt-in and confirm server event',()=>{
 const s=load('src/geofences/M4GeofencePanel.tsx');
 assert.match(s,/const \[foregroundAlerts,setForegroundAlerts\]=useState\(false\)/);
 assert.match(s,/const alertsRef=useRef\(false\)/);
 assert.match(s,/alertsRef\.current=next;setForegroundAlerts\(next\)/);
 assert.match(s,/onEvent:event=>/);
 assert.match(s,/if\(!alive\.current\|\|AppState\.currentState!=='active'\)return/);
 assert.match(s,/Platform\.OS==='android'&&alertsRef\.current/);
 assert.match(s,/Alert\.alert\(/);
 assert.match(s,/alertsRef\.current=false;setForegroundAlerts\(false\)/);
 assert.match(s,/zoneWatch\.current\?\.stop\(\)/);
 assert.doesNotMatch(s,/expo-notifications|scheduleNotificationAsync|setNotificationHandler|addNotificationResponseReceivedListener|AsyncStorage/);
});
test('M4 alert is not mistakenly packaged as an ungated Android default notification channel',()=>{
 const index=load('index.ts'),eas=load('eas.json'),
  native=load('.github/workflows/android-m2-native-staging-apk.yml'),
  wiring=load('src/geofences/M4GeofenceStagingScreens.tsx'),
  model=load('src/geofences/m4ForegroundZoneWatch.ts');
 assert.match(wiring,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES!=='true'/);
 assert.doesNotMatch(native,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES: 'true'/);
 assert.doesNotMatch(eas,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES/);
 assert.match(model,/if\(event==='enter'\|\|event==='exit'\)p\.onEvent\(event\)/);
 assert.doesNotMatch(index,/M4GeofencePanel/);
});
