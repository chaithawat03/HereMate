import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createNodeLocationHandler} from '../backend/location-runtime/edge.mjs';
import {
  runM3V2StagingRouteSmoke,validateM3V2StagingOrigin
} from '../scripts/m3-v2-staging-readonly-smoke.mjs';

const APPROVED='https://heremate-m2-location-staging-976775896533.asia-southeast1.run.app';
const ALT='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
const response=(status=405,headers={},error=status===404?'not_found':'method_not_allowed')=>({
  status,json:async()=>({error}),headers:{
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

test('GET-only route presence verifies M2 compatibility and all 3 M3 v2 paths without real credentials, GPS, or mutation',async()=>{
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
    assert.equal(opts.headers.Authorization,'heremate-route-probe-not-a-bearer-token');
    assert.doesNotMatch(opts.headers.Authorization,/^Bearer /i);
    assert.equal(opts.headers['Cache-Control'],'no-store');
  }
  assert.doesNotMatch(JSON.stringify(result.results),/sessionToken|latitude|longitude|bearer/i);
});

test('missing v2 route, generic gateway 405, wrong method behavior, cache, CORS, HTML, TLS or redirect fail closed',async()=>{
  for(const bad of [response(404),response(200),response(401),
    response(405,{'cache-control':'public, max-age=60'}),
    response(405,{'access-control-allow-origin':'*'}),
    response(405,{'content-type':'text/html'}),
    response(405,{},'unexpected_error'),
    {...response(405),json:async()=>{throw Error('bad json');}}]){
    await denied({origin:APPROVED,approved:true,fetchImpl:async()=>bad});
  }
  await denied({origin:APPROVED,approved:true,fetchImpl:async()=>{throw Error('redirect blocked');}});
  await denied({origin:APPROVED,approved:true,fetchImpl:async()=>response(405)}); // generic gateway 405 even for unknown path
});

test('read-only probe bounds an abort-ignoring HTTPS fetch and never probes a second route',async()=>{
  let requests=0;
  await denied({origin:APPROVED,approved:true,deadlineMs:25,
    fetchImpl:async()=>{
      requests++;
      return new Promise(()=>{}); // ignores AbortSignal forever
    }});
  assert.equal(requests,1);
});

test('read-only probe bounds stalled response.json and ignores a late valid body',async()=>{
  let requests=0,releaseJson;
  const probe=runM3V2StagingRouteSmoke({origin:APPROVED,approved:true,
    deadlineMs:25,fetchImpl:async()=>{
      requests++;
      return {...response(),json:()=>new Promise(resolve=>{releaseJson=resolve;})};
    }});
  await assert.rejects(probe,/M3_V2_ROUTE_SMOKE_BLOCKED/);
  assert.equal(requests,1);
  assert.equal(typeof releaseJson,'function');
  releaseJson({error:'method_not_allowed'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,1,'late response must not advance to a second route');
});

test('invalid route deadlines are denied before any network access',async()=>{
  let requests=0;
  for(const deadlineMs of [0,19,8001,Infinity,NaN,'8000',null]){
    await denied({origin:APPROVED,approved:true,deadlineMs,
      fetchImpl:async()=>{requests++;return response();}});
  }
  assert.equal(requests,0);
});

test('smoke is separate from app code and deploy scripts; approved origins match mobile transport',()=>{
  const script=readFileSync(new URL('../scripts/m3-v2-staging-readonly-smoke.mjs',import.meta.url),'utf8');
  const mobile=readFileSync(new URL('../src/location/m2StagingTransport.ts',import.meta.url),'utf8');
  assert.match(script,/HEREMATE_M3_V2_READONLY_APPROVED/);
  for(const origin of [APPROVED,ALT])assert.ok(script.includes(origin));
  // If the reviewed mobile transport allowlist changes, CI must catch
  // the drift instead of allowing a stale/unrelated Staging smoke probe.
  const allowlist=/export const APPROVED_M2_STAGING_ORIGINS=Object\.freeze\(\[([\s\S]*?)\]\)/.exec(mobile);
  assert.ok(allowlist,'mobile Staging allowlist must remain explicitly defined');
  const mobileOrigins=[...allowlist[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
  assert.deepEqual(mobileOrigins.slice().sort(),[APPROVED,ALT].sort());
  assert.equal(new Set(mobileOrigins).size,2,'no duplicated or unreviewed Staging origins');
  for(const origin of mobileOrigins)assert.equal(validateM3V2StagingOrigin(origin),origin);
  assert.doesNotMatch(script,/method:'POST'|Bearer\s+[A-Za-z0-9._-]{32,}|firebase-admin|setDoc\(|addDoc\(|startLocationUpdatesAsync|gcloud run deploy/);
});

// Regression: actual Staging edge checks Authorization HEADER COUNT before
// routing GET. A header-free probe sees 401 even for real v2 endpoints.
// Only an invalid non-Bearer marker can safely reveal 405 vs 404.
test('real Node Staging edge: invalid non-Bearer marker enables GET-only route detection without authenticating',async t=>{
  const service=Object.fromEntries(['start','stop','publish','read'].map(name=>[
    name,()=>{throw Error('GET must never execute a location mutation or read');}
  ]));
  const server=createServer(createNodeLocationHandler(service));
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
  const local='http://127.0.0.1:'+server.address().port;
  const unauthenticated=await fetch(local+'/v2/locations/sessions/start',{method:'GET'});
  assert.equal(unauthenticated.status,401);
  const seen=[];
  const result=await runM3V2StagingRouteSmoke({origin:APPROVED,approved:true,
    fetchImpl:(url,options)=>{
      seen.push({url,options});
      return fetch(local+new URL(url).pathname,options);
    }
  });
  assert.equal(result.verifiedRoutes,4);
  assert.equal(result.negativeControls,1);
  assert.deepEqual(result.results.map(x=>x.status),[405,405,405,405,404]);
  assert.equal(seen.length,5);
  for(const {options} of seen){
    assert.equal(options.method,'GET');
    assert.equal(options.body,undefined);
    assert.equal(options.headers.Authorization,'heremate-route-probe-not-a-bearer-token');
  }
});
