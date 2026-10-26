import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createM2StagingTransport} from '../src/location/m2StagingTransport.ts';
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
test('M4 optional M3 device capability is scoped to EVALUATE, never to REVOKE or zone proposal',async()=>{
 let activeToken='a'.repeat(64);
 const x=make({getPublisherSessionToken:()=>activeToken});
 assert.equal((await x.transport.propose(PEER,circle)).proposed,true);
 assert.equal((await x.transport.revoke(PEER,UID)).revoked,true);
 const fix={latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:now()-100};
 assert.equal((await x.transport.evaluate(PEER,fix)).event,'enter');
 assert.equal(x.calls.length,3);
 assert.equal(JSON.parse(x.calls[0].init.body).sessionToken,undefined);
 assert.equal(JSON.parse(x.calls[1].init.body).sessionToken,undefined);
 assert.equal(JSON.parse(x.calls[2].init.body).sessionToken,activeToken);
 activeToken=null;
 await assert.rejects(x.transport.evaluate(PEER,fix),/M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(x.calls.length,3,'no private GPS request without a device capability');
 assert.equal((await x.transport.revoke(PEER,UID)).revoked,true,
   'independent revoke remains available without device capability');
 assert.equal(x.calls.length,4);
});

test('M4 reads M3 device capability only after awaited identity and OS permission preflight',async()=>{
 let activeToken='a'.repeat(64),resume;
 let started;
 const waiting=new Promise(resolve=>{resume=resolve;});
 const entered=new Promise(resolve=>{started=resolve;});
 const x=make({
   getPublisherSessionToken:()=>activeToken,
   currentIdentity:()=>({uid:UID,getIdToken:async()=>{started();await waiting;return SECRET;}})
 });
 const fix={latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:now()-100};
 const pending=x.transport.evaluate(PEER,fix);
 await entered;
 activeToken='b'.repeat(64);
 resume();
 assert.equal((await pending).event,'enter');
 assert.equal(JSON.parse(x.calls[0].init.body).sessionToken,'b'.repeat(64),
   'stale capability from before awaited Firebase token must not be sent');
});

test('M4 suppresses in-flight v2 geofence event after same-UID device capability handoff',async()=>{
 let activeToken='a'.repeat(64),resume,entered;
 const waiting=new Promise(resolve=>{resume=resolve;});
 const requestEntered=new Promise(resolve=>{entered=resolve;});
 const sent=[];
 const x=make({
   getPublisherSessionToken:()=>activeToken,
   fetchImpl:async(input,init)=>{
     sent.push({input,init});
     entered();
     await waiting;
     return {status:200,ok:true,json:async()=>({
       evaluated:true,event:'enter',quality:'ok'
     })};
   }
 });
 const fix={latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:now()-100};
 const pending=x.transport.evaluate(PEER,fix);
 await requestEntered;
 assert.equal(JSON.parse(sent[0].init.body).sessionToken,'a'.repeat(64));
 activeToken='b'.repeat(64); // same Firebase UID, newer publisher session
 resume();
 await assert.rejects(pending,/M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(sent.length,1,'stale event must never trigger another request');
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
test('M4 v2 UI cannot mount without an explicit same-device publisher capability bridge',()=>{
 const wiring=read('src/geofences/M4GeofenceStagingScreens.tsx');
 const androidRoot=read('M2StagingApp.tsx');
 const iosRoot=read('M3IOSStagingApp.tsx');
 const transport=read('src/geofences/m4StagingTransport.ts');
 assert.match(wiring,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS==='true'/);
 assert.match(wiring,/Platform.OS==='ios'&&/);
 assert.match(wiring,/EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND==='true'/);
 assert.match(read('src/location/M3IOSStagingScreens.tsx'),/useDeviceSessions:true/);
 assert.match(wiring,/requiresV2Capability&&typeof getPublisherSessionToken!=='function'/);
 assert.match(wiring,/requiresV2Capability\?\{getPublisherSessionToken\}:\{\}/);
 assert.match(wiring,/getPublisherSessionToken\?:\(actorUid:string,ownerUid:string\)=>string\|null/);
 assert.match(transport,/getPublisherSessionToken\?:\(actorUid:string,ownerUid:string\)=>string\|null/);
 // Neither current app root supplies a publisher bearer to the M4 panel.
 // A future v2 release MUST explicitly wire a same-account/same-device
 // scoped bridge rather than silently using a v1 UID-only EVALUATE.
 assert.doesNotMatch(androidRoot,/getPublisherSessionToken=/);
 assert.doesNotMatch(iosRoot,/getPublisherSessionToken=/);
 assert.doesNotMatch(read('eas.json'),/EXPO_PUBLIC_ENABLE_M4_GEOFENCES/);
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


test('M4 v2 asks the capability provider for the exact owner peer before send and after reply',async()=>{
 const requested=[];
 const x=make({getPublisherSessionToken:(actorUid,ownerUid)=>{
   requested.push([actorUid,ownerUid]);
   return ownerUid===PEER?'a'.repeat(64):null;
 }});
 const point={latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:now()-100};
 assert.equal((await x.transport.evaluate(PEER,point)).event,'enter');
 assert.deepEqual(requested,[[UID,PEER],[UID,PEER]]);
 const other='anotherowneruid00003';
 await assert.rejects(x.transport.evaluate(other,point),/M4_GEOFENCE_NOT_AVAILABLE/);
 assert.deepEqual(requested,[[UID,PEER],[UID,PEER],[UID,other]]);
 assert.equal(x.calls.length,1,'a lease for one peer must not send GPS for another peer');
});

test('M3 and M4 transports can share only the same in-memory peer-scoped publisher capability',async()=>{
 const token='b'.repeat(64),owner='geofencesubjectuid002';
 const calls=[];
 let actor=UID;
 const m3=createM2StagingTransport({
   approvedCloudRunUrl:ORIGIN,projectId:'heremate',useDeviceSessions:true,
   currentIdentity:()=>actor?{uid:actor,getIdToken:async()=>SECRET}:null,
   isForeground:()=>true,foregroundPermissionGranted:async()=>true,
   fetchImpl:async(url,init)=>{
     calls.push({url,body:JSON.parse(init.body)});
     return {ok:true,status:200,json:async()=>url.endsWith('/start')?
       {enabled:true,expiresAtMs:now()+50_000,sessionToken:token}:
       {enabled:false}};
   }
 });
 // Here M3 actor must be the same Firebase identity used by M4.
 // The M3 lease is tied to one peer; M4 must never infer it from UID alone.
 actor=UID;
 const publisherPeer=PEER;
 assert.equal(m3.getPublisherSessionToken(publisherPeer),null);
 await m3.start(publisherPeer);
 const m4=make({getPublisherSessionToken:(actorUid,peer)=>
   m3.getPublisherSessionToken(actorUid,peer)});
 const fix={latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:now()-100};
 assert.equal((await m4.transport.evaluate(publisherPeer,fix)).event,'enter');
 assert.equal(JSON.parse(m4.calls[0].init.body).sessionToken,token);
 await assert.rejects(m4.transport.evaluate('otherowneruid00003',fix),
   /M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(m4.calls.length,1,'different peer cannot borrow the publisher lease');
 const otherAccount=make({
   currentIdentity:()=>({uid:'otherfirebaseactor00003',getIdToken:async()=>SECRET}),
   getPublisherSessionToken:(actorUid,peer)=>
     m3.getPublisherSessionToken(actorUid,peer)
 });
 await assert.rejects(otherAccount.transport.evaluate(publisherPeer,fix),
   /M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(otherAccount.calls.length,0,
   'a different Firebase actor cannot transmit GPS with another account lease');
 await m3.stop(publisherPeer);
 await assert.rejects(m4.transport.evaluate(publisherPeer,fix),
   /M4_GEOFENCE_NOT_AVAILABLE/);
 assert.equal(m4.calls.length,1,'retired lease must not send a second GPS fix');
 assert.deepEqual(calls.map(x=>new URL(x.url).pathname),[
   '/v2/locations/sessions/start','/v2/locations/sessions/stop'
 ]);
 assert.equal(calls[0].body.sessionToken,undefined,
   'START response token is never stored in a request body');
});
