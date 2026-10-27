import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyAndroidGoogleOAuthSigner,verifyAndroidGoogleOAuthPackage} from '../scripts/verify-android-google-oauth-signer.mjs';
import {googleStagingAndroidSha1} from '../src/config/googleStaging.ts';

const sample=(sha1=googleStagingAndroidSha1,extra='')=>
  'Verifies\nVerified using v2 scheme (APK Signature Scheme v2): true\n'+
  'Number of signers: 1\nSigner #1 certificate DN: CN=Android Debug\n'+
  'Signer #1 certificate SHA-1 digest: '+sha1+'\n'+extra;
const rejected=text=>assert.throws(()=>verifyAndroidGoogleOAuthSigner(text),
  /ANDROID_GOOGLE_OAUTH_SIGNER_MISMATCH_OR_UNVERIFIED/);

test('accepts exactly the registered Firebase Android OAuth signing SHA-1',()=>{
  const result=verifyAndroidGoogleOAuthSigner(sample());
  assert.deepEqual(result,{status:'MATCH',signerCount:1,sha1:googleStagingAndroidSha1});
  const colon=googleStagingAndroidSha1.toUpperCase().match(/../g).join(':');
  assert.equal(verifyAndroidGoogleOAuthSigner(sample(colon)).sha1,googleStagingAndroidSha1);
});

test('rejects the ACTUAL delivered debug-signed APK certificate mismatch',()=>{
  // SHA-1 extracted independently from actual M3 Preview APK; public cert digest, not a secret.
  const actualDebugSha1='5e8f16062ea3cd2c4a0d547876baa6f38cabf625';
  assert.notEqual(actualDebugSha1,googleStagingAndroidSha1);
  rejected(sample(actualDebugSha1));
});

test('rejects ambiguous, missing, malformed and multiple signers even if one matches',()=>{
  rejected('');
  rejected('Signer #1 certificate SHA-256 digest: '+'a'.repeat(64));
  rejected(sample('a'.repeat(39)));
  rejected(sample('a'.repeat(41)));
  rejected(sample(googleStagingAndroidSha1,'Signer #2 certificate SHA-1 digest: '+googleStagingAndroidSha1+'\n'));
  rejected(sample().replace('Number of signers: 1','Number of signers: 2'));
  rejected(sample().replaceAll('Signer #1','Signer #2'));
  rejected(sample()+'DOES NOT VERIFY\n');
  rejected('a'.repeat(131073));
});


test('compiled APK package must match the registered Google Android OAuth application ID',()=>{
  const good="package: name='com.chaithawat03.heremate' versionCode='1' versionName='0.1.0'\\n";
  assert.deepEqual(verifyAndroidGoogleOAuthPackage(good),
    {status:'MATCH',packageName:'com.chaithawat03.heremate'});
  for(const bad of [
    '',"package: name='com.chaithawat03.heremate.debug' versionCode='1'\\n",
    "package: name='com.attacker.heremate' versionCode='1'\\n",
    "package: name='com.chaithawat03.heremate'\\npackage: name='com.chaithawat03.heremate'\\n",
    "package: name='com.chaithawat03.heremate\\n",
    "package: name='com.chaithawat03.heremate.extra'\\n",
    'x'.repeat(131073)
  ]){
    assert.throws(()=>verifyAndroidGoogleOAuthPackage(bad),
      /ANDROID_GOOGLE_OAUTH_SIGNER_MISMATCH_OR_UNVERIFIED/);
  }
});

test('owner-only Google-enabled M2 APK must pass signing gate BEFORE artifact upload',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/android-m2-native-staging-apk.yml',import.meta.url),'utf8');
  const testScript=readFileSync(new URL('../scripts/verify-android-google-oauth-signer.mjs',import.meta.url),'utf8');
  assert.match(workflow,/EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN: 'true'/);
  assert.match(workflow,/apksigner.*verify --verbose --print-certs/);
  assert.match(workflow,/aapt.*dump badging/);
  assert.match(workflow,/heremate-android-package\\.txt/);
  assert.match(workflow,/node scripts\/verify-android-google-oauth-signer\.mjs/);
  const gate=workflow.indexOf('Verify signed APK Google OAuth certificate');
  const artifact=workflow.indexOf('Retain ONE Android Staging APK');
  assert.ok(gate>0&&artifact>gate);
  assert.doesNotMatch(workflow,/GOOGLE_DRIVE_REFRESH_TOKEN|gcloud run deploy|firebase deploy/);
  assert.doesNotMatch(testScript,/keystorePassword|private_key|console\.log\(.*token/);
});
