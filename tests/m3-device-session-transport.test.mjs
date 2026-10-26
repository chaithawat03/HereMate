import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createM2StagingTransport} from '../src/location/m2StagingTransport.ts';

const SELF='ownerdeviceuid000001',PEER='viewerdeviceuid000002';
const TOKEN='T'.repeat(80),CAP='a'.repeat(64);
const ORIGIN='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fix=()=>({latitude:13.7,longitude:100.5,accuracyMeters:17,
 capturedAtMs:Date.now()-100});
function harness(extra={}){
 const calls=[];
 let who=SELF,active=true,permission=true;
 const transport=createM2StagingTransport({
  approvedCloudRunUrl:ORIGIN,projectId:'heremate',useDeviceSessions:true,
  currentIdentity:()=>who?{uid:who,getIdToken:async()=>TOKEN}:null,
  isForeground:()=>active,foregroundPermissionGranted:async()=>permission,
  fetchImpl:async(url,opts)=>{
    const path=new URL(url).pathname;
    calls.push({path,body:JSON.parse(opts.body),headers:opts.headers});
    const data=path.endsWith('/start')?
      {enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP}:
      path.endsWith('/publish')?{stored:true,expiresAtMs:Date.now()+20_000}:
      path.endsWith('/stop')?{enabled:false}:{point:fix(),expiresAtMs:Date.now()+20_000};
    return {ok:true,status:200,json:async()=>data};
  },
  ...extra
 });
 return {transport,calls,setUser:x=>who=x,setActive:x=>active=x,
  setPermission:x=>permission=x};
}
test('M3 v2 session token is opaque, in memory and binds Start/Publish/Stop',async()=>{
 const x=harness();
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
 await assert.rejects(x.transport.stop(PEER),/UNAVAILABLE/);
 assert.equal(x.calls.length,0);
 const start=await x.transport.start(PEER);
 assert.equal(start.enabled,true);
 assert.equal(Object.hasOwn(start,'sessionToken'),false);
 await x.transport.publish(PEER,fix());
 assert.deepEqual(await x.transport.stop(PEER),{enabled:false});
 assert.deepEqual(x.calls.map(r=>r.path),[
  '/v2/locations/sessions/start','/v2/locations/sessions/publish',
  '/v2/locations/sessions/stop'
 ]);
 assert.deepEqual(Object.keys(x.calls[0].body),['viewerUid']);
 assert.deepEqual(Object.keys(x.calls[1].body).sort(),[
  'appInForeground','foregroundPermissionGranted','point','sessionToken','viewerUid'
 ]);
 assert.equal(x.calls[1].body.sessionToken,CAP);
 assert.equal(x.calls[2].body.sessionToken,CAP);
 for(const row of x.calls){
  assert.equal(row.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(row.headers['Cache-Control'],'no-store');
 }
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
 await assert.rejects(x.transport.stop(PEER),/UNAVAILABLE/);
 assert.equal(x.calls.length,3);
});
test('M3 capability cannot be used after auth/background/OS permission changes',async()=>{
 const x=harness();
 await x.transport.start(PEER);
 x.setUser('secondowneruid00003');
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
 await assert.rejects(x.transport.stop(PEER),/UNAVAILABLE/);
 assert.equal(x.calls.length,1);
 const y=harness();
 await y.transport.start(PEER);
 y.setActive(false);
 await assert.rejects(y.transport.publish(PEER,fix()),/UNAVAILABLE/);
 y.setActive(true);y.setPermission(false);
 await assert.rejects(y.transport.publish(PEER,fix()),/UNAVAILABLE/);
 assert.equal(y.calls.length,1);
});
test('M3 transport drops delayed network results after Firebase account change',async()=>{
 let release;
 const deferred=new Promise(resolve=>{release=resolve;});
 const x=harness({fetchImpl:async()=>{await deferred;
  return {ok:true,status:200,json:async()=>({
    enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP
  })};
 }});
 const pending=x.transport.start(PEER);
 await Promise.resolve();await Promise.resolve();
 x.setUser('secondowneruid00003');
 release();
 await assert.rejects(pending,/UNAVAILABLE/);
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
});
test('v1 Android remains unchanged while iOS M3 and opt-in Android use v2',()=>{
 const android=read('src/location/M2AndroidStagingScreens.tsx');
 const ios=read('src/location/M3IOSStagingScreens.tsx');
 const build=read('.github/workflows/android-m2-native-staging-apk.yml');
 const eas=read('eas.json');
 assert.match(android,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS==='true'/);
 assert.match(ios,/useDeviceSessions:true/);
 assert.doesNotMatch(build,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS/);
 assert.doesNotMatch(eas,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS/);
 assert.match(read('src/location/m2StagingTransport.ts'),/deviceSession/);
});

test('M3 concurrent START is single-flight and cannot overwrite the device capability',async()=>{
 let release,requestSeen;
 const gate=new Promise(resolve=>{release=resolve;});
 const seen=new Promise(resolve=>{requestSeen=resolve;});
 let starts=0;
 const x=harness({fetchImpl:async(url)=>{
   if(new URL(url).pathname!=='/v2/locations/sessions/start')
     throw Error('unexpected_request');
   starts++;requestSeen();
   await gate;
   return {ok:true,status:200,json:async()=>({
     enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP
   })};
 }});
 const first=x.transport.start(PEER);
 await seen;
 await assert.rejects(x.transport.start(PEER),/UNAVAILABLE/);
 assert.equal(starts,1,'only the first START reaches authenticated backend');
 release();
 assert.equal((await first).enabled,true);
 await assert.rejects(x.transport.start(PEER),/UNAVAILABLE/);
 assert.equal(starts,1,'active capability cannot be overwritten');
});

test('M3 failed START releases local lock for an explicit retry without caching a token',async()=>{
 let attempts=0;
 const x=harness({fetchImpl:async()=>{
   attempts++;
   if(attempts===1)return {ok:false,status:503,json:async()=>({})};
   return {ok:true,status:200,json:async()=>({
     enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP
   })};
 }});
 await assert.rejects(x.transport.start(PEER),/UNAVAILABLE/);
 assert.equal((await x.transport.start(PEER)).enabled,true);
 assert.equal(attempts,2);
 await assert.rejects(x.transport.start(PEER),/UNAVAILABLE/);
 assert.equal(attempts,2);
});


test('M3->M4 publisher capability lookup is peer-scoped, in-memory, and revoked on account switch',async()=>{
 const x=harness();
 const other='anotherpeeruid000003';
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null);
 await x.transport.start(PEER);
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),CAP);
 assert.equal(x.transport.getPublisherSessionToken(SELF,other),null);
 assert.equal(x.transport.getPublisherSessionToken('differentactoruid00003',PEER),null,
   'a different M4 Firebase actor cannot borrow this handset lease');
 assert.equal(x.transport.getPublisherSessionToken(SELF,SELF),null);
 x.setActive(false);
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null);
 x.setActive(true);
 x.setUser('secondowneruid00003');
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null);
 x.setUser(SELF);
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null,
   'an observed account switch permanently retires the previous capability');
 assert.equal(x.calls.length,1,'read-only lookup must not call network');
});

test('M3->M4 publisher capability is hidden while STOP is pending and after confirmed STOP',async()=>{
 let resumeStop,stopEntered;
 const waiting=new Promise(resolve=>{resumeStop=resolve;});
 const entered=new Promise(resolve=>{stopEntered=resolve;});
 const x=harness({fetchImpl:async(url)=>{
   if(new URL(url).pathname.endsWith('/start'))return {
     ok:true,status:200,json:async()=>({
       enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP
     })
   };
   stopEntered();
   await waiting;
   return {ok:true,status:200,json:async()=>({enabled:false})};
 }});
 await x.transport.start(PEER);
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),CAP);
 const stop=x.transport.stop(PEER);
 await entered;
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null,
   'M4 must not borrow token after STOP was initiated');
 resumeStop();
 assert.deepEqual(await stop,{enabled:false});
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null);
});

test('M3->M4 bridge never exposes a publisher token past its lease expiry',async()=>{
 const x=harness({fetchImpl:async()=>({
   ok:true,status:200,json:async()=>({
     enabled:true,expiresAtMs:Date.now()+120,sessionToken:CAP
   })
 })});
 await x.transport.start(PEER);
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),CAP);
 await new Promise(resolve=>setTimeout(resolve,170));
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null);
});


test('M3 v2 rejects an overlong START lease before retaining a publisher capability',async()=>{
 let attempts=0;
 const x=harness({fetchImpl:async(url)=>{
   assert.equal(new URL(url).pathname,'/v2/locations/sessions/start');
   attempts++;
   return {ok:true,status:200,json:async()=>({
     enabled:true,expiresAtMs:Date.now()+(attempts===1?300_000:50_000),
     sessionToken:CAP
   })};
 }});
 await assert.rejects(x.transport.start(PEER),/UNAVAILABLE/);
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null,
   'a forged five-minute server lease must not become an M4 GPS capability');
 assert.equal((await x.transport.start(PEER)).enabled,true,
   'rejected START must release the local lock for a reviewed retry');
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),CAP);
 assert.equal(attempts,2);
});

test('M3 v2 never sends GPS after its local lease expires, while STOP remains possible',async()=>{
 const x=harness({fetchImpl:async(url)=>{
   const path=new URL(url).pathname;
   return {ok:true,status:200,json:async()=>path.endsWith('/start')?
     {enabled:true,expiresAtMs:Date.now()+70,sessionToken:CAP}:
     {enabled:false}};
 }});
 await x.transport.start(PEER);
 await new Promise(resolve=>setTimeout(resolve,110));
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null);
 assert.deepEqual(await x.transport.stop(PEER),{enabled:false},
   'STOP must not be blocked by a locally expired capability');
});

test('M3 v2 blocks GPS if STOP starts while native OS permission is pending',async()=>{
 let permissionPending=false,releasePermission,permissionSeen,stopSeen,releaseStop;
 const permissionGate=new Promise(resolve=>{releasePermission=resolve;});
 const permissionStarted=new Promise(resolve=>{permissionSeen=resolve;});
 const stopGate=new Promise(resolve=>{releaseStop=resolve;});
 const stopStarted=new Promise(resolve=>{stopSeen=resolve;});
 const sent=[];
 const x=harness({
   foregroundPermissionGranted:async()=>{
     if(permissionPending){permissionSeen();await permissionGate;}
     return true;
   },
   fetchImpl:async(url,init)=>{
     const path=new URL(url).pathname;
     sent.push(path);
     if(path.endsWith('/start'))return {ok:true,status:200,json:async()=>({
       enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP
     })};
     if(path.endsWith('/stop')){
       stopSeen();await stopGate;
       return {ok:true,status:200,json:async()=>({enabled:false})};
     }
     throw Error('GPS_MUST_NOT_LEAVE_AFTER_STOP_REQUEST');
   }
 });
 await x.transport.start(PEER);
 permissionPending=true;
 const publishing=x.transport.publish(PEER,fix());
 await permissionStarted;
 const stopping=x.transport.stop(PEER);
 await stopStarted;
 assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null);
 permissionPending=false;
 releasePermission();
 await assert.rejects(publishing,/UNAVAILABLE/);
 assert.deepEqual(sent,[
   '/v2/locations/sessions/start','/v2/locations/sessions/stop'
 ],'a pending STOP must fence the final pre-send GPS gate');
 releaseStop();
 assert.deepEqual(await stopping,{enabled:false});
});

test('M3 v2 suppresses a late GPS publish ACK after local or owner-wide STOP begins',async()=>{
 for(const stopKind of ['stop','emergencyStop']){
   let publishEntered,releasePublish,stopEntered,releaseStop;
   const publishGate=new Promise(resolve=>{releasePublish=resolve;});
   const publishSeen=new Promise(resolve=>{publishEntered=resolve;});
   const stopGate=new Promise(resolve=>{releaseStop=resolve;});
   const stopSeen=new Promise(resolve=>{stopEntered=resolve;});
   const sent=[];
   const x=harness({fetchImpl:async(url)=>{
     const path=new URL(url).pathname;
     sent.push(path);
     if(path.endsWith('/start'))return {ok:true,status:200,json:async()=>({
       enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP
     })};
     if(path.endsWith('/publish')){
       publishEntered();
       await publishGate;
       return {ok:true,status:200,json:async()=>({
         stored:true,expiresAtMs:Date.now()+20_000
       })};
     }
     if(path.endsWith('/stop')){
       stopEntered();
       await stopGate;
       return {ok:true,status:200,json:async()=>({enabled:false})};
     }
     throw Error('UNEXPECTED_ENDPOINT');
   }});
   await x.transport.start(PEER);
   const publishing=x.transport.publish(PEER,fix());
   await publishSeen; // GPS was sent BEFORE STOP; no claim of undoing it.
   const stopping=x.transport[stopKind](PEER);
   await stopSeen;
   assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null,
     'M4 cannot borrow a capability while STOP is pending');
   releasePublish();
   await assert.rejects(publishing,/UNAVAILABLE/,
     'late success must not turn a STOP-requested UI back to SHARING');
   releaseStop();
   assert.deepEqual(await stopping,{enabled:false},
     'STOP must still obtain its own confirmed server ACK');
   assert.equal(x.transport.getPublisherSessionToken(SELF,PEER),null);
   assert.deepEqual(sent,[
     '/v2/locations/sessions/start',
     '/v2/locations/sessions/publish',
     stopKind==='stop'?'/v2/locations/sessions/stop':'/v1/locations/grants/stop'
   ]);
 }
});
