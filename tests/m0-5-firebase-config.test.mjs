import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const config = read('src/config/firebaseStaging.ts');
const app = JSON.parse(read('app.json'));
const policy = JSON.parse(read('security/staging-exceptions.json'));

test('Firebase JS SDK config pins the registered owner staging project and app IDs', () => {
  assert.match(config, /projectId: 'heremate'/);
  assert.match(config, /projectNumber: '976775896533'/);
  assert.match(config, /messagingSenderId: '976775896533'/);
  assert.match(config, /webAppId: '1:976775896533:web:c71784a039e43386aa315c'/);
  assert.match(config, /androidAppId: '1:976775896533:android:a34f7f3aa147c2bcaa315c'/);
  assert.match(config, /appId: '1:976775896533:web:c71784a039e43386aa315c'/);
  assert.equal(app.expo.android.package, 'com.chaithawat03.heremate');
  assert.equal(app.expo.ios.bundleIdentifier, 'com.chaithawat03.heremate');
  assert.equal(app.expo.extra.environment, 'staging');
  assert.match(config, /assertFirebaseStagingIdentity/);
});

test('No web Analytics or database/auth side effects before backend rules pass', () => {
  assert.doesNotMatch(config, /getAnalytics\s*\(|firebase\/analytics|initializeApp\s*\(|getAuth\s*\(|signIn|setDoc\s*\(|set\s*\(/);
  assert.doesNotMatch(read('App.tsx'), /firebase\/?|authState|signInWithCustomToken/);
  assert.equal(policy.sourceScope, 'synthetic-data-only');
  assert.equal(policy.expiresOn, '2026-11-20');
});

test('No new production profile or app-domain dependency', () => {
  const eas = JSON.parse(read('eas.json'));
  assert.equal(Object.hasOwn(eas.build, 'production'), false);
  assert.doesNotMatch(config, /google-services\.json|EXPO_PUBLIC_DOMAIN|https:\/\/heremate\.app/);
});
