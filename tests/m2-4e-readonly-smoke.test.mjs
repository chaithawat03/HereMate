import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateM2SmokeOrigin,runM2ReadOnlySmoke} from '../scripts/m2-4-readonly-cloudrun-smoke.mjs';
const ORIGIN='https://heremate-m2-location-staging-abc.a.run.app';
const READ='/v1/locations/points/read';
const src=readFileSync(new URL('../scripts/m2-4-readonly-cloudrun-smoke.mjs',import.meta.url),'utf8');

test('Staging-only origin rejects arbitrary host, query, auth, path, HTTP and Production',()=>{
 assert.equal(validateM2SmokeOrigin(ORIGIN+'/'),ORIGIN);
 for(const bad of [
  'http://heremate-m2-location-staging-abc.a.run.app/',
  'https://production-service-abc.a.run.app/',
  'https://evil.example/',
  'https://heremate-m2-location-staging-abc.a.run.app.evil.example/',
  'https://user:pass@heremate-m2-location-staging-abc.a.run.app/',
  ORIGIN+'/private',ORIGIN+'/?token=secret',ORIGIN+'/#credentials'
 ])assert.throws(()=>validateM2SmokeOrigin(bad),/M2_STAGING_SMOKE_BLOCKED/);
});
test('No network requests without staging approval, even with a valid URL',async()=>{
 let calls=0;
 await assert.rejects(runM2ReadOnlySmoke({origin:ORIGIN,fetchImpl:async()=>{calls++;}}),
   /explicit approved staging smoke required/);
 assert.equal(calls,0);
});
test('Read-only negative HTTP probes are strict; no real token, GPS or mutation sent',async()=>{
 const seen=[];
 const mock=async(url,init)=>{
  const u=new URL(url);
  assert.equal(u.origin,ORIGIN);
  assert.equal(u.pathname,READ);
  assert.equal(init.redirect,'error');
  assert.ok(init.signal);
  assert.equal(init.headers['Cache-Control'],'no-store');
  assert.ok(!/location\/grants|points\/publish/.test(u.pathname));
  if(init.body)assert.ok(!init.body.includes('latitude'));
  assert.ok(!init.headers.Authorization ||
    init.headers.Authorization.startsWith('Bearer '));
  const n=seen.length;seen.push({url,init});
  const statuses=[401,401,404,405,415,413,404];
  return {status:statuses[n],headers:{get:k=>({
    'cache-control':'no-store, private, max-age=0',
    'content-type':'application/json; charset=utf-8'
  })[k]??null}};
 };
 const report=await runM2ReadOnlySmoke({origin:ORIGIN,consent:true,fetchImpl:mock});
 assert.equal(report.count,7);
 assert.equal(seen.length,7);
 assert.equal(seen.filter(x=>x.init.method==='GET').length,1);
 assert.equal(seen.filter(x=>!x.init.headers.Authorization).length,1);
 assert.ok(seen.every(x=>x.url.includes('/points/read')));
 assert.ok(seen.every(x=>!/start|stop|publish/.test(new URL(x.url).pathname)));
 assert.doesNotMatch(src,/firebase-admin|GOOGLE_APPLICATION_CREDENTIALS|gcloud run deploy/);
});
test('A deployed edge allowing unauthorized read, wildcard CORS or cached errors fails closed',async()=>{
 const goodHeaders={get:k=>({
   'cache-control':'no-store, private, max-age=0',
   'content-type':'application/json'
 })[k]??null};
 for(const reply of [
  {status:200,headers:goodHeaders},
  {status:401,headers:{get:k=>k==='cache-control'?'public,max-age=60':goodHeaders.get(k)}},
  {status:401,headers:{get:k=>k==='access-control-allow-origin'?'*':goodHeaders.get(k)}}
 ]){
  await assert.rejects(runM2ReadOnlySmoke({origin:ORIGIN,consent:true,
    fetchImpl:async()=>reply}),/M2_STAGING_SMOKE_BLOCKED/);
 }
});
test('Owner-approved EAS keeps manual build but avoids interim milestone auto-builds',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/staging-eas-build.yml',import.meta.url),'utf8');
 assert.doesNotMatch(workflow,/^  push:/m);
 assert.match(workflow,/^  workflow_dispatch:/m);
 assert.match(workflow,/STAGING_EAS_ENABLED/);
 assert.match(workflow,/inputs\.run_mode == 'build'/);
 assert.doesNotMatch(src,/EXPO_TOKEN|STAGING_DRIVE_ENABLED|signInWith|refreshAccessToken/);
});
