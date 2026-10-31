import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {mapStyleUrl} from '../src/map/styles.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const require=createRequire(import.meta.url);
const baseConfig=JSON.parse(read('app.json'));
const loadConfig=flag=>{
  const saved=process.env.EXPO_PUBLIC_ENABLE_HEREMATE_V2;
  if(flag===undefined)delete process.env.EXPO_PUBLIC_ENABLE_HEREMATE_V2;
  else process.env.EXPO_PUBLIC_ENABLE_HEREMATE_V2=flag;
  try{
    const path=require.resolve('../app.config.js');
    delete require.cache[path];
    return require(path)({config:structuredClone(baseConfig.expo)});
  }finally{
    if(saved===undefined)delete process.env.EXPO_PUBLIC_ENABLE_HEREMATE_V2;
    else process.env.EXPO_PUBLIC_ENABLE_HEREMATE_V2=saved;
  }
};
const locationOptions=cfg=>cfg.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-location')[1];

test('index routes to the v2 root only on Android with the v2 flag', () => {
  const index=read('index.ts');
  // Lazy: older builds must never load v2 modules (Firebase/background task side effects).
  assert.doesNotMatch(index,/import HereMateApp/);
  assert.match(index,/heremateV2 \? require\('\.\/HereMateApp'\)\.default/);
  assert.match(index,/Platform\.OS === 'android' &&\s*process\.env\.EXPO_PUBLIC_ENABLE_HEREMATE_V2 === 'true'/);
  assert.match(index,/registerRootComponent\(heremateV2 \? require\('\.\/HereMateApp'\)\.default : m2AndroidStaging\s*\?\s*M2StagingApp/);
});

test('static app.json keeps background location off for every existing build', () => {
  const options=locationOptions(baseConfig.expo);
  assert.equal(options.isAndroidBackgroundLocationEnabled,false);
  assert.equal(options.isAndroidForegroundServiceEnabled,false);
});

test('app.config.js leaves config unchanged without the v2 flag', () => {
  assert.deepEqual(loadConfig(undefined),baseConfig.expo);
  assert.deepEqual(loadConfig('false'),baseConfig.expo);
});

test('app.config.js enables v2 background location, permissions and MapLibre only with the flag', () => {
  const cfg=loadConfig('true');
  const options=locationOptions(cfg);
  assert.equal(options.isAndroidBackgroundLocationEnabled,true);
  assert.equal(options.isAndroidForegroundServiceEnabled,true);
  assert.equal(options.isIosBackgroundLocationEnabled,false);
  for(const p of ['ACCESS_FINE_LOCATION','ACCESS_BACKGROUND_LOCATION','FOREGROUND_SERVICE',
    'FOREGROUND_SERVICE_LOCATION','POST_NOTIFICATIONS'])
    assert.ok(cfg.android.permissions.includes(p),p);
  assert.ok(cfg.plugins.some(p=>p==='@maplibre/maplibre-react-native'||
    (Array.isArray(p)&&p[0]==='@maplibre/maplibre-react-native')));
  // The static base object is never mutated.
  assert.equal(locationOptions(baseConfig.expo).isAndroidBackgroundLocationEnabled,false);
});

test('map styles come from OpenFreeMap with no API key', () => {
  assert.match(mapStyleUrl('light'),/^https:\/\/tiles\.openfreemap\.org\/styles\//);
  assert.match(mapStyleUrl('dark'),/^https:\/\/tiles\.openfreemap\.org\/styles\//);
  assert.doesNotMatch(mapStyleUrl('light')+mapStyleUrl('dark'),/key=|token=/i);
});

test('v2 preview workflow is dispatch-only, read-only and secret-free', () => {
  const path='.github/workflows/android-v2-preview-apk.yml';
  assert.ok(existsSync(new URL('../'+path,import.meta.url)));
  const wf=read(path);
  assert.match(wf,/^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(wf,/^\s+(push|pull_request|issue_comment|schedule):/m);
  assert.match(wf,/^permissions:\n  contents: read\n/m);
  assert.match(wf,/inputs\.confirm_target == 'heremate\/android-v2-preview'/);
  assert.doesNotMatch(wf,/secrets\./);
  for(const flag of ['EXPO_PUBLIC_ENABLE_HEREMATE_V2','EXPO_PUBLIC_ENABLE_FIREBASE_GUEST',
    'EXPO_PUBLIC_ENABLE_M1_PROFILE','EXPO_PUBLIC_ENABLE_M1_FRIENDS','EXPO_PUBLIC_ENABLE_M2_SHARING',
    'EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN','EXPO_PUBLIC_ENABLE_LOCAL_GPS'])
    assert.match(wf,new RegExp(flag+": 'true'"),flag);
  assert.match(wf,/EXPO_PUBLIC_ENVIRONMENT: staging/);
  assert.match(wf,/actions\/upload-artifact@v4/);
  assert.match(wf,/retention-days: 7/);
  assert.match(wf,/apkSha256/);
});

test('PR CI runs every v2 test file and the typecheck', async () => {
  const {readdirSync}=await import('node:fs');
  const ci=read('.github/workflows/pr-ci.yml');
  const files=readdirSync(new URL('../tests/',import.meta.url)).filter(f=>/^v2-.*\.test\.mjs$/.test(f));
  assert.ok(files.length>=10,'v2 test files found: '+files.length);
  for(const f of files)assert.match(ci,new RegExp('node --test tests/'+f.replace(/\./g,'\\.')),f);
  assert.match(ci,/npm run typecheck/);
});
