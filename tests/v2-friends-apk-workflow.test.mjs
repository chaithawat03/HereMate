import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const path='.github/workflows/android-v2-friends-apk.yml';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
// Public Expo/AOSP debug certificate. A friends APK must never be signed with it.
const EXPO_DEBUG_SHA1='5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25';

test('friends APK workflow exists, is owner-dispatch only and read-only', () => {
  assert.ok(existsSync(new URL('../'+path,import.meta.url)));
  const wf=read(path);
  assert.match(wf,/^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(wf,/^\s+(push|pull_request|pull_request_target|issue_comment|schedule|workflow_run):/m);
  assert.match(wf,/^permissions:\n  contents: read\n/m);
  assert.match(wf,/github\.repository == 'chaithawat03\/HereMate'/);
  assert.match(wf,/inputs\.confirm_target == 'heremate\/android-v2-friends'/);
  assert.match(wf,/EXPO_PUBLIC_ENVIRONMENT: staging/);
  assert.match(wf,/EXPO_PUBLIC_ENABLE_HEREMATE_V2: 'true'/);
});

test('signs with the HereMate upload key from secrets only, never the debug key', () => {
  const wf=read(path);
  assert.match(wf,/secrets\.HEREMATE_UPLOAD_KEYSTORE_B64/);
  assert.match(wf,/secrets\.HEREMATE_UPLOAD_KEYSTORE_PASSWORD/);
  // Only these two secrets are referenced.
  const used=new Set([...wf.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m=>m[1]));
  assert.deepEqual([...used].sort(),['HEREMATE_UPLOAD_KEYSTORE_B64','HEREMATE_UPLOAD_KEYSTORE_PASSWORD']);
  // Fails closed when the secret is missing instead of falling back to debug signing.
  assert.match(wf,/FRIENDS_APK_BLOCKED: signing secrets missing/);
  assert.match(wf,/android\.injected\.signing\.store\.file/);
  // Keystore lives outside the workspace and is deleted even on failure.
  assert.match(wf,/RUNNER_TEMP/);
  assert.match(wf,/if: always\(\)[\s\S]*rm -f/);
  // Secrets are scoped to steps, never job-level env.
  const jobEnv=wf.split(/\n    steps:\n/)[0];
  assert.doesNotMatch(jobEnv,/secrets\./);
  // Never echo the password.
  assert.doesNotMatch(wf,/echo[^\n]*\$\{?KEYSTORE_(PASSWORD|B64)/);
});

test('verifies the APK certificate is not the public debug certificate and records it', () => {
  const wf=read(path);
  assert.match(wf,/apksigner/);
  assert.match(wf,/verify --print-certs/);
  assert.ok(wf.includes(EXPO_DEBUG_SHA1.replace(/:/g,'').toLowerCase()),'debug cert digest is rejected');
  assert.match(wf,/FRIENDS_APK_BLOCKED: signed with the public debug certificate/);
  assert.match(wf,/certSha1/);
  assert.match(wf,/apkSha256/);
  assert.match(wf,/index\.android\.bundle/);
});

test('uploads one artifact and never uploads the keystore', () => {
  const wf=read(path);
  assert.match(wf,/actions\/upload-artifact@v4/);
  assert.match(wf,/name: HereMate-Friends-APK/);
  const upload=wf.slice(wf.indexOf('actions/upload-artifact@v4'));
  assert.doesNotMatch(upload,/\.p12|\.jks|keystore/i);
});

test('keystores are git-ignored', () => {
  const gi=read('.gitignore');
  assert.match(gi,/\*\.p12/);
  assert.match(gi,/\*\.jks/);
});
