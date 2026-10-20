import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const eas = JSON.parse(read('eas.json'));

test('Android hero uses installable internal APK', () => {
  assert.equal(eas.build['android-preview'].distribution, 'internal');
  assert.equal(eas.build['android-preview'].android.buildType, 'apk');
});

test('iOS parallel build targets simulator, not physical iPhone', () => {
  assert.equal(eas.build['ios-simulator'].ios.simulator, true);
  assert.equal(eas.build['ios-simulator'].distribution, 'internal');
});

test('M0 excludes production build profile', () => {
  assert.equal(Object.hasOwn(eas.build, 'production'), false);
});

test('PR CI is isolated from cloud credentials and automatic deployment', () => {
  const ci = read('.github/workflows/pr-ci.yml');
  assert.match(ci, /pull_request:/);
  assert.doesNotMatch(ci, /EXPO_TOKEN|GOOGLE_DRIVE_REFRESH_TOKEN|id-token: write|eas build|firebase deploy/);
});

test('M0 runbook requires physical verification and private My Drive OAuth', () => {
  const plan = read('docs/M0_FOUNDATION.md');
  assert.match(plan, /Android.*device/i);
  assert.match(plan, /OAuth/);
  assert.match(plan, /Restricted/);
  assert.match(plan, /Production/);
});

test('Secrets and build artifacts are ignored', () => {
  const ignore = read('.gitignore');
  for (const key of ['.env', '*.jks', '*.ipa', '*.apk']) {
    assert.ok(ignore.includes(key), key);
  }
  assert.ok(existsSync(new URL('../README.md', import.meta.url)));
});
