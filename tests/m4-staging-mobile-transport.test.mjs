import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createM4StagingTransport,APPROVED_M4_STAGING_ORIGINS
} from '../src/geofences/m4StagingTransport.ts';

const UID='geofencesubjectuid002',PEER='geofenceowneruid00001';
const SECRET='T'.repeat(72);
const ORIGIN=APPROVED_M4_STAGING_ORIGINS[1];
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const circle={latitude:13.7563,longitude:100.5018,radiusMeters:350};
const proposalCreatedAtMs=1_800_000_000_000;
const now=()=>Date.now();
function make(extra={}){
 const calls=[];
 let active=true,permission=true,user=UID;
 const origin=()=>({uid:user,getIdToken:async()=>SECRET});
 const ports={
   approvedCloudRunUrl:ORIGIN,projectId:'heremate',
   currentIdentity:()=>origin(),isForeground:()=>active,
   foregroundPermissionGranted:async()=>permission,
   fetchImpl:async(input,init)=>{
     calls.push({input,init});
     const path=new globalThis.URL(input).pathname;
     const replies={
       '/v1/geofences/propose':{proposed:true,expiresAtMs:now()+30_000},
       '/v1/geofences/review':{circle,expiresAtMs:now()+30_000,
         proposalCreatedAtMs},
       '/v1/geofences/decide':JSON.parse(init.body).approve?
         {approved:true,expiresAtMs:now()+30_000}:{approved:false},
       '/v1/geofences/revoke':{revoked:true},
       '/v1/geofences/evaluate':{evaluated:true,event:'enter',quality:'ok'}
     };
     return {status:200,ok:true,json:async()=>replies[path]};
   },...extra
 };
 return {transport:createM4StagingTransport(ports),calls,
   setActive:x=>{active=x;},setPermission:x=>{permission=x;},setUser:x=>{user=x;}};
}
test('only exact owner-reviewed Cloud Run HTTPS origins can be used',()=>{
 assert.equal(APPROVED_M4_STAGING_ORIGINS.length,2);
 for(const origin of [
  'https://example.com',
  'http://heremate-m2-location-staging-2inhowyo2a-as.a.run.app',
  ORIGIN+'/v1/geofences/review',
  ORIGIN+'?debug=1',
  ORIGIN+'.evil.invalid'
 ])assert.throws(()=>createM4StagingTransport({
   approvedCloudRunUrl:origin,projectId:'heremate',
   currentIdentity:()=>({uid:UID,getIdToken:async()=>SECRET}),
   isForeground:()=>true,
   foregroundPermissionGranted:async()=>true,
   fetchImpl:async()=>({ok:true,status:200,json:async()=>({})})
 }),/M4_GEOFENCE_NOT_AVAILABLE/);
});
test('consent UX APIs send exact, authenticated, no-store POST bodies only',async()=>{
 const x=make();
 assert.equal((await x.transport.propose(PEER,circle)).proposed,true);
 const reviewed=await x.transport.review(PEER);
 assert.deepEqual(reviewed.circle,circle);
 assert.equal(reviewed.proposalCreatedAtMs,proposalCreatedAtMs);
 assert.equal((await x.transport.decide(PEER,true,proposalCreatedAtMs)).approved,true);
 assert.equal((await x.transport.decide(PEER,false,proposalCreatedAtMs)).approved,false);
 assert.equal((await x.transport.revoke(PEER,UID)).revoked,true);
 assert.equal((await x.transport.evaluate(PEER,{
   latitude:13.757,longitude:100.5,accuracyMeters:11,capturedAtMs:now()-500
 })).event,'enter');
 assert.equal(x.calls.length,6);
 assert.deepEqual(JSON.parse(x.calls[2].init.body),
   {ownerUid:PEER,approve:true,proposalCreatedAtMs});
 assert.deepEqual(JSON.parse(x.calls[3].init.body),
   {ownerUid:PEER,approve:false,proposalCreatedAtMs});
 for(const row of x.calls){
   assert.match(String(row.input),/^https:\/\//);
   assert.equal(row.init.method,'POST');
   assert.equal(row.init.redirect,'error','Private zone/GPS POST must not follow redirects');
   assert.equal(row.init.headers.Authorization,'Bearer '+SECRET);
   assert.equal(row.init.headers['Cache-Control'],'no-store');
   assert.ok(!row.input.includes('?'));
   assert.ok(row.init.signal);
   assert.ok(!row.init.body.includes('firebaseToken'));
 }
 const paths=x.calls.map(r=>new URL(r.input).pathname);
 assert.deepEqual(paths,[
  '/v1/geofences/propose','/v1/geofences/review','/v1/geofences/decide',
  '/v1/geofences/decide','/v1/geofences/revoke','/v1/geofences/evaluate'
 ]);
});
test('invalid coordinates, permission OFF or forged caller never send GPS or proposed circle',async()=>{
 const x=make();
 await assert.rejects(x.transport.propose(PEER,{...circle,radiusMeters:10}),/M4_GEOFENCE_NOT_AVAILABLE/);
 await assert.rejects(x.transport.propose(PEER,{...circle,latitude:NaN}),/M4_GEOFENCE_NOT_AVAILABLE/);
 await assert.rejects(x.transport.propose(UID,circle),/M4_GEOFENCE_NOT_AVAILABLE/);
 await assert.rejects(x.transport.revoke(PEER,'strangeruid000001'),/M4_GEOFENCE_NOT_AVAILABLE/);
 await assert.rejects(x.transport.evaluate(PEER,{
   latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:now()-60_000
 }),/M4_GEOFENCE_NOT_AVAILABLE/);
 await assert.rejects(x.transport.decide(PEER,true,NaN),/M4_GEOFENCE_NOT_AVAILABLE/);
 await assert.rejects(x.transport.decide(PEER,false,0),/M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(x.calls.length,0);
 x.setPermission(false);
 await assert.rejects(x.transport.evaluate(PEER,{
   latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:now()-100
 }),/M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(x.calls.length,0);
 x.setActive(false);
 await assert.rejects(x.transport.review(PEER),/M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(x.calls.length,0);
});
test('logout or permissions revocation while HTTP response pending cannot deliver zone coordinates/event',async()=>{
 let finish;
 const defer=new Promise(resolve=>{finish=resolve;});
 const m=make({fetchImpl:async()=>{await defer;return {
   status:200,ok:true,json:async()=>({circle,expiresAtMs:now()+10_000})
 };}});
 const requested=m.transport.review(PEER);
 await Promise.resolve();
 m.setUser('anotheraccount00002');
 finish();
 await assert.rejects(requested,/M4_GEOFENCE_NOT_AVAILABLE/);
 let finish2;
 const deferred=new Promise(resolve=>{finish2=resolve;});
 let permit=true;
 const v=make({foregroundPermissionGranted:async()=>permit,
   fetchImpl:async()=>{await deferred;return{
     status:200,ok:true,json:async()=>({evaluated:true,event:'enter',quality:'ok'})
   };}
 });
 const pending=v.transport.evaluate(PEER,{
   latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:now()-100
 });
 await Promise.resolve();
 permit=false;
 finish2();
 await assert.rejects(pending,/M4_GEOFENCE_NOT_AVAILABLE/);
});
test('M4 UI requires independent owner/subject consent, distinct revoke and explicit OS GPS tap',()=>{
 const app=read('M2StagingApp.tsx');
 const ios=read('M3IOSStagingApp.tsx');
 const panels=read('src/geofences/M4GeofencePanel.tsx');
 const wiring=read('src/geofences/M4GeofenceStagingScreens.tsx');
 const androidWorkflow=read('.github/workflows/android-m2-native-staging-apk.yml');
 const eas=read('eas.json');
 assert.match(app,/process\.env\.EXPO_PUBLIC_ENABLE_M4_GEOFENCES==='true'/);
 assert.match(ios,/process\.env\.EXPO_PUBLIC_ENABLE_M4_GEOFENCES==='true'/);
 assert.match(wiring,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES!=='true'/);
 assert.match(wiring,/AppState\.currentState==='active'/);
 assert.match(wiring,/getStagingGuestAuth\(\)\.currentUser/);
 assert.match(panels,/transport\.review/);
 assert.match(panels,/transport\.decide\(peer\.uid,true,reviewed\.proposalCreatedAtMs\)/);
 assert.match(panels,/transport\.decide\(peer\.uid,false,reviewed\.proposalCreatedAtMs\)/);
 assert.match(panels,/reviewed\?\.ownerUid===peer\.uid/);
 assert.match(panels,/transport\.revoke\(peer\.uid,uid\)/);
 assert.match(panels,/transport\.revoke\(uid,peer\.uid\)/);
 assert.match(panels,/requestForegroundPermissionsAsync/);
 assert.match(panels,/getCurrentPositionAsync/);
 assert.match(panels,/if\(isCurrent\(\)\)setReviewed/);
 assert.match(panels,/watchPositionAsync/);
 assert.match(panels,/zoneWatch\.current\?\.start/);
 assert.doesNotMatch(panels,/TaskManager|startLocationUpdatesAsync|AsyncStorage|setItem\(/);
 assert.doesNotMatch(androidWorkflow,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES:/);
 assert.doesNotMatch(eas,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES/);
 assert.doesNotMatch(read('App.tsx'),/M4GeofencePanel|M4GeofenceStagingScreens/);
});

test('M4 rejects 307/308 responses rather than exposing a consented zone to redirected services',async()=>{
 for(const status of [301,302,303,307,308]){
   const seen=[];
   const x=make({fetchImpl:async(input,init)=>{
     seen.push({input,init});
     return {status,ok:false,json:async()=>({location:'https://foreign.run.app/steal'})};
   }});
   await assert.rejects(x.transport.propose(PEER,circle),
     /M4_GEOFENCE_NOT_AVAILABLE/);
   assert.equal(seen.length,1);
   assert.equal(seen[0].init.redirect,'error');
   assert.equal(new URL(seen[0].input).origin,ORIGIN);
   assert.ok(!String(seen[0].input).includes('foreign.run.app'));
 }
});


test('M4 entire-request deadline rejects hung Firebase token and never sends a late zone revoke',async()=>{
 let release;
 const waiting=new Promise(resolve=>{release=resolve;});
 const sent=[];
 const x=make({
   timeoutMs:1000,
   currentIdentity:()=>({uid:UID,getIdToken:()=>waiting}),
   fetchImpl:async(input)=>{sent.push(input);throw Error('late private POST');}
 });
 const pending=x.transport.revoke(PEER,UID);
 await assert.rejects(pending,/M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(sent.length,0,'no request can leave while Firebase token is unresolved');
 release(SECRET);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.length,0,'late Firebase token must not issue a revoked request');
});

test('M4 entire-request deadline rejects hung OS permission and never sends GPS after it resolves',async()=>{
 let release;
 const waiting=new Promise(resolve=>{release=resolve;});
 const sent=[];
 const x=make({
   timeoutMs:1000,
   foregroundPermissionGranted:()=>waiting,
   fetchImpl:async(input)=>{sent.push(input);throw Error('late GPS POST');}
 });
 const pending=x.transport.evaluate(PEER,{
   latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:now()
 });
 await assert.rejects(pending,/M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(sent.length,0,'private GPS must never leave during a hung OS prompt');
 release(true);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sent.length,0,'late permission approval must not publish stale GPS');
});

test('M4 entire-request deadline bounds HTTP and JSON awaits even when fetch mocks ignore AbortSignal',async()=>{
 let releaseFetch;
 const waitingFetch=new Promise(resolve=>{releaseFetch=resolve;});
 let observedSignal;
 const x=make({
   timeoutMs:1000,
   fetchImpl:async(_url,opts)=>{
     observedSignal=opts.signal;
     await waitingFetch;
     return {ok:true,status:200,json:async()=>({revoked:true})};
   }
 });
 const pending=x.transport.revoke(PEER,UID);
 await assert.rejects(pending,/M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(observedSignal.aborted,true,'network signal must be aborted');
 releaseFetch();
 await new Promise(resolve=>setImmediate(resolve));
 let releaseJson;
 const waitingJson=new Promise(resolve=>{releaseJson=resolve;});
 const y=make({
   timeoutMs:1000,
   fetchImpl:async()=>({ok:true,status:200,json:()=>waitingJson})
 });
 const pendingJson=y.transport.review(PEER);
 await assert.rejects(pendingJson,/M4_GEOFENCE_NOT_AVAILABLE/);
 releaseJson({circle,expiresAtMs:now()+10_000,proposalCreatedAtMs});
 await new Promise(resolve=>setImmediate(resolve));
});
