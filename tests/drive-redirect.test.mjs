import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEasArtifactDestination } from '../scripts/publish-staging-drive.mjs';

const source='https://expo.dev/artifacts/eas/TwEwt2dY2Ly4jXyv0YaxnS-KF6P0ppTZBnUWpXsZxTA.apk';
test('Expo APK origin and direct HTTPS artifact are accepted',()=>{
 assert.doesNotThrow(()=>validateEasArtifactDestination(source,source));
});
test('Expo HTTPS redirects to standard S3, region-specific S3, Google Storage and CDN are supported',()=>{
 for(const dest of [
   'https://turtle-v2-artifacts.s3.amazonaws.com/android/release.apk?X-Amz-Signature=private',
   'https://expo-artifacts.s3.us-west-2.amazonaws.com/android/release.apk?X-Amz-Signature=private',
   'https://s3.us-east-1.amazonaws.com/turtle-v2-artifacts/release.apk',
   'https://storage.googleapis.com/eas-artifacts/release.apk',
   'https://d123abc.cloudfront.net/android/release.apk?token=private',
   'https://assets.eascdn.net/android/release.apk',
   'https://expo-artifacts.blob.core.windows.net/android/release.apk'
 ]) assert.doesNotThrow(()=>validateEasArtifactDestination(source,dest),dest.split('?')[0]);
});
test('Reject untrusted origin and redirected scheme or host, do not leak presigned query',()=>{
 for(const [first,dest] of [
  ['http://expo.dev/artifacts/eas/test.apk','https://storage.googleapis.com/file.apk'],
  ['https://expo.dev.evil.test/artifacts/eas/test.apk','https://storage.googleapis.com/file.apk'],
  ['https://expo.dev/login','https://storage.googleapis.com/file.apk'],
  [source,'http://turtle-v2-artifacts.s3.amazonaws.com/file.apk'],
  [source,'https://malicious.tld/file.apk?secret=never-logged'],
  [source,'https://turtle-v2-artifacts.s3.amazonaws.com.evil.test/file.apk'],
  [source,'https://username:password@storage.googleapis.com/file.apk']
 ]) {
   assert.throws(()=>validateEasArtifactDestination(first,dest),/BLOCKED/);
 }
 try {validateEasArtifactDestination(source,'https://malicious.tld/file.apk?secret=never-logged')}
 catch(e){ assert.doesNotMatch(e.message,/never-logged/);assert.match(e.message,/malicious.tld/);}
});
test('Workflow gates remain restricted to reviewed Android and opt-in private Drive',()=>{
 const w=(await import('node:fs')).readFileSync(new URL('../.github/workflows/staging-eas-build.yml',import.meta.url),'utf8');
 assert.match(w,/STAGING_DRIVE_ENABLED/);
 assert.match(w,/environment: staging-drive/);
 assert.match(w,/inputs.run_mode == 'build'/);
});
