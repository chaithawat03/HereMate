import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  runM3V2StagingRouteSmoke,validateM3V2StagingOrigin
} from '../scripts/m3-v2-staging-readonly-smoke.mjs';

const APPROVED='https://heremate-m2-location-staging-976775896533.asia-southeast1.run.app';
const ALT='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
const response=(status=405,headers={})=>({status,headers:{
  get(name){return ({'cache-control':'no-store, private, max-age=0',
    'content-type':'application/json; charset=utf-8',...headers})[name]??null;}
}});

const denied=async args=>assert.rejects(
  runM3V2StagingRouteSmoke(args),/M3_V2_ROUTE_SMOKE_BLOCKED/);

test('only two exact reviewed HTTPS Staging origins; no arbitrary Cloud Run wildcard',()=>{
  assert.equal(validateM3V2StagingOrigin(APPROVED+'/'),APPROVED);
  assert.equal(validateM3V2StagingOrigin(ALT),ALT);
  for(const origin of [null,'http://'+new URL(APPROVED).hostname,
    APPROVED+'/v2/locations/sessions/start',APPROVED+'?x=1',
    APPROVED+'#x',APPROVED.replace('https://','https://a@'),
    'https://heremate-m2-location-staging-evil.asia-southeast1.run.app',
    'https://other-service.run.app',
    'https://heremate-m2-location-staging-976775896533.asia-southeast1.run.app.evil.com']){
    assert.throws(()=>validateM3V2StagingOrigin(origin),/M3_V2_ROUTE_SMOKE_BLOCKED/);
  }
});

test('operator approval required before any HTTPS call',async()=>{
  let requests=0;
  await denied({origin:APPROVED,fetchImpl:async()=>{requests++;return response();}});
  assert.equal(requests,0);
});

test('GET-only route presence verifies M2 compatibility and all 3 M3 v2 paths without tokens, GPS, or mutation',async()=>{
  const seen=[];
  const result=await runM3V2StagingRouteSmoke({origin:APPROVED,approved:true,
    fetchImpl:async(url,opts)=>{
      seen.push({url,opts});
      return response(url.endsWith('/__not_a_route__')?404:405);
    }});
  assert.equal(result.verifiedRoutes,4);
  assert.equal(result.negativeControls,1);
  assert.equal(result.results.length,5);
  assert.deepEqual(seen.map(x=>new URL(x.url).pathname),[
    '/v1/locations/points/read','/v2/locations/sessions/start',
    '/v2/locations/sessions/publish','/v2/locations/sessions/stop',
    '/v2/locations/sessions/__not_a_route__'
  ]);
  for(const {url,opts} of seen){
    assert.equal(new URL(url).origin,APPROVED);
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.body,undefined);
    assert.equal(opts.headers.Authorization,undefined);
    assert.equal(opts.headers['Cache-Control'],'no-store');
  }
  assert.doesNotMatch(JSON.stringify(result.results),/sessionToken|latitude|longitude|bearer/i);
});

test('missing v2 route, generic gateway 405, wrong method behavior, cache, CORS, HTML, TLS or redirect fail closed',async()=>{
  for(const bad of [response(404),response(200),response(401),
    response(405,{'cache-control':'public, max-age=60'}),
    response(405,{'access-control-allow-origin':'*'}),
    response(405,{'content-type':'text/html'})]){
    await denied({origin:APPROVED,approved:true,fetchImpl:async()=>bad});
  }
  await denied({origin:APPROVED,approved:true,fetchImpl:async()=>{throw Error('redirect blocked');}});
  await denied({origin:APPROVED,approved:true,fetchImpl:async()=>response(405)}); // generic gateway 405 even for unknown path
});

test('smoke is separate from app code and deploy scripts; approved origins match mobile transport',()=>{
  const script=readFileSync(new URL('../scripts/m3-v2-staging-readonly-smoke.mjs',import.meta.url),'utf8');
  assert.match(script,/HEREMATE_M3_V2_READONLY_APPROVED/);
  for(const origin of [APPROVED,ALT])assert.ok(script.includes(origin));
  assert.doesNotMatch(script,/method:'POST'|Authorization:|firebase-admin|setDoc\(|addDoc\(|startLocationUpdatesAsync|gcloud run deploy/);
});
