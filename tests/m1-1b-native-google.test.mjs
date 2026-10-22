import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertAndroidGoogleStagingConfig,googleStagingWebClientId,googleStagingAndroidSha1} from '../src/config/googleStaging.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const google=JSON.parse(read('google-services.json'));
const app=JSON.parse(read('app.json'));
const pkg=JSON.parse(read('package.json'));
const lock=JSON.parse(read('package-lock.json'));
const eas=JSON.parse(read('eas.json'));

test('uploaded Firebase Android config matches exact signed APK SHA-1 and Web OAuth client',()=>{
  assert.doesNotThrow(()=>assertAndroidGoogleStagingConfig(google));
  assert.equal(googleStagingAndroidSha1,'203f89bb96a20c39a157341611dacb5dead88d15');
  assert.equal(googleStagingWebClientId,google.client[0].oauth_client.find(x=>x.client_type===3).client_id);
  for(const mutate of [
    d=>d.project_info.project_id='wrong-project',
    d=>d.client[0].client_info.android_client_info.package_name='wrong-package',
    d=>d.client[0].oauth_client.find(x=>x.client_type===1).android_info.certificate_hash='0'.repeat(40),
    d=>d.client[0].oauth_client.find(x=>x.client_type===3).client_id='wrong-client'
  ]){
    const x=structuredClone(google);mutate(x);
    assert.throws(()=>assertAndroidGoogleStagingConfig(x),/MISMATCH/);
  }
});
test('native Google library and Expo Android config exact locked, no iOS or Production opt-in',()=>{
  assert.equal(pkg.dependencies['@react-native-google-signin/google-signin'],'16.1.5');
  assert.equal(lock.packages[''].dependencies['@react-native-google-signin/google-signin'],'16.1.5');
  assert.equal(lock.packages['node_modules/@react-native-google-signin/google-signin'].version,'16.1.5');
  assert.equal(app.expo.android.googleServicesFile,'./google-services.json');
  assert.ok(app.expo.plugins.includes('@react-native-google-signin/google-signin'));
  assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN,'true');
  assert.equal(eas.build['android-preview'].env.EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN,undefined);
  assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN,undefined);
  assert.equal(eas.build.production,undefined);
});
test('native Android picker is user-initiated and passes token only to Firebase bridge',()=>{
  const native=read('src/auth/nativeGoogleSignIn.android.ts');
  const fallback=read('src/auth/nativeGoogleSignIn.ts');
  const gate=read('src/auth/GuestAuthGate.tsx');
  assert.match(native,/GoogleSignin\.configure\(/);
  assert.match(native,/googleStagingWebClientId/);
  assert.match(native,/GoogleSignin\.hasPlayServices/);
  assert.match(native,/GoogleSignin\.signIn\(\)/);
  assert.match(native,/isSuccessResponse/);
  assert.match(native,/response\.data\.idToken/);
  assert.match(gate,/continueStagingGoogleWithNativeToken\(obtainNativeGoogleIdToken\)/);
  assert.match(gate,/Platform\.OS === 'android'/);
  assert.match(gate,/state\.kind === "guest" && googleEnabled/);
  assert.match(fallback,/GOOGLE_SIGNIN_ANDROID_ONLY/);
  assert.doesNotMatch(native+gate,/console\.log|console\.error|AsyncStorage|setDoc|updateDoc|requestBackgroundPermissions|startLocationUpdatesAsync|serverAuthCode/);
});

test('EAS uploads Firebase client config while continuing to exclude credentials',()=>{
  const ignore=read('.gitignore').trimEnd().split(/\r?\n/);
  const archiveRules=read('.easignore').trimEnd().split(/\r?\n/);
  assert.ok(ignore.includes('google-services.json'));
  for(const rule of ignore.filter(line=>line && !line.startsWith('#'))) assert.ok(archiveRules.includes(rule), 'Missing original ignore rule: '+rule);
  const active=archiveRules.filter(line=>line && !line.startsWith('#'));
  assert.equal(active.at(-1),'!google-services.json');
  assert.ok(active.lastIndexOf('!google-services.json') > active.lastIndexOf('google-services.json'));
  assert.ok(!active.some(rule=>rule==='!*.pem' || rule==='!.env' || rule==='!*.keystore'));
  assert.equal(JSON.parse(read('google-services.json')).project_info.project_id,'heremate');
  assert.equal(app.expo.newArchEnabled,undefined); // SDK 57 schema rejects this old property.
});
