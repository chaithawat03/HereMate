import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertStagingOrigin,STAGING_ORIGINS,syntheticFix} from '../scripts/m2-staging-live-e2e.mjs';
test('exact observed Cloud Run staging URLs only',()=>{
  for(const url of STAGING_ORIGINS)assert.equal(assertStagingOrigin(url),url);
  for(const url of [
    'https://example.com',
    'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app.evil.invalid',
    'http://heremate-m2-location-staging-2inhowyo2a-as.a.run.app',
    'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app/?x=1',
    'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app/v1/locations/points/read',
    ''
  ])assert.throws(()=>assertStagingOrigin(url),/M2_LIVE_STAGING_BLOCKED/);
});
test('synthetic test coordinates are non-geographic and never from device',()=>{
  assert.deepEqual(syntheticFix(1750000000000),{
    latitude:0,longitude:0,accuracyMeters:10,capturedAtMs:1749999999500
  });
  assert.throws(()=>syntheticFix(0),/M2_LIVE_STAGING_BLOCKED/);
});
test('live test cannot run in CI or deploy a runtime or emit test identities',()=>{
  const s=readFileSync(new URL('../scripts/m2-staging-live-e2e.mjs',import.meta.url),'utf8');
  const workflow=readFileSync(new URL('../.github/workflows/pr-ci.yml',import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/node scripts\/m2-staging-live-e2e\.mjs/);
  assert.match(s,/--confirm=heremate-m2-staging/);
  assert.match(s,/M2 LIVE STAGING E2E: PASS/);
  assert.match(s,/CLEANUP_NOTE/);
  assert.match(s,/recipientConsent:\{booleanValue:false\}/);
  assert.match(s,/syntheticFix\(\)/);
  assert.doesNotMatch(s,/gcloud run deploy|gcloud builds submit|console\.log\(owner|console\.log\(viewer/);
});