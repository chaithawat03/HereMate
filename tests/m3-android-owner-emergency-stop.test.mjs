import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createM2StagingTransport} from '../src/location/m2StagingTransport.ts';
import {createForegroundSharingController} from '../src/location/m2ForegroundSession.ts';
import {handleLocationHttp} from '../backend/location/http.mjs';

const SELF='ownerdeviceuid000001',PEER='viewerdeviceuid000002';
const TOKEN='T'.repeat(80),CAP='a'.repeat(64);
const ORIGIN='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
function rig(deviceSessions=false){
 let uid=SELF,foreground=true,permit=false,mode='ok',pause=null;
 const calls=[];
 const backend={
  async startDevice(){return {enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP};},
  async stop({idToken,viewerUid}){
   assert.equal(idToken,TOKEN);assert.equal(viewerUid,PEER);
   return {enabled:false};
  }
 };
 const transport=createM2StagingTransport({
   approvedCloudRunUrl:ORIGIN,projectId:'heremate',
   useDeviceSessions:deviceSessions,
   currentIdentity:()=>uid?{uid,getIdToken:async()=>TOKEN}:null,
   isForeground:()=>foreground,
   foregroundPermissionGranted:async()=>permit,
   fetchImpl:async(url,opts)=>{
     const path=new URL(url).pathname;
     calls.push({path,body:JSON.parse(opts.body),headers:opts.headers});
     if(mode==='offline')throw Error('disconnected');
     if(pause)await pause;
     if(mode==='malformed')return {ok:true,status:200,
       json:async()=>({enabled:true})};
     const reply=await handleLocationHttp({
       method:opts.method,path,contentType:opts.headers['Content-Type'],
       authorization:opts.headers.Authorization,bodyText:opts.body
     },backend);
     return {ok:reply.status===200,status:reply.status,
       json:async()=>reply.body};
   }
 });
 return {transport,calls,
   setUid:x=>{uid=x;},setForeground:x=>{foreground=x;},
   setPermission:x=>{permit=x;},setMode:x=>{mode=x;},
   setPause:p=>{pause=p;}
 };
}
test('owner emergency STOP succeeds without local publisher token, GPS or foreground permission',async()=>{
 const x=rig(false);
 assert.deepEqual(await x.transport.emergencyStop(PEER),{enabled:false});
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].path,'/v1/locations/grants/stop');
 assert.deepEqual(x.calls[0].body,{viewerUid:PEER});
 assert.equal(x.calls[0].headers.Authorization,'Bearer '+TOKEN);
 assert.equal(x.calls[0].headers['Cache-Control'],'no-store');
 assert.equal(Object.hasOwn(x.calls[0].body,'sessionToken'),false);
 x.setForeground(false);x.setPermission(false);
 assert.deepEqual(await x.transport.emergencyStop(PEER),{enabled:false});
 assert.equal(x.calls.length,2);
});
test('lost device v2 capability is unnecessary for owner-revocation, and successful STOP clears local memory',async()=>{
 const x=rig(true);
 await assert.rejects(x.transport.stop(PEER),/UNAVAILABLE/);
 assert.deepEqual(await x.transport.emergencyStop(PEER),{enabled:false});
 assert.equal(x.calls.length,1);
 x.setPermission(true);
 await x.transport.start(PEER);
 assert.equal(x.calls.at(-1).path,'/v2/locations/sessions/start');
 assert.deepEqual(await x.transport.emergencyStop(PEER),{enabled:false});
 assert.equal(x.calls.at(-1).path,'/v1/locations/grants/stop');
 await assert.rejects(x.transport.publish(PEER,{
   latitude:0,longitude:0,accuracyMeters:5,capturedAtMs:Date.now()-500
 }),/UNAVAILABLE/);
 await assert.rejects(x.transport.stop(PEER),/UNAVAILABLE/);
 assert.equal(x.calls.length,3);
});
test('no UI confirmation on invalid response, network failure or account-change in-flight',async()=>{
 const x=rig();
 x.setMode('malformed');
 await assert.rejects(x.transport.emergencyStop(PEER),/UNAVAILABLE/);
 x.setMode('offline');
 await assert.rejects(x.transport.emergencyStop(PEER),/UNAVAILABLE/);
 x.setMode('ok');
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 x.setPause(gate);
 const pending=x.transport.emergencyStop(PEER);
 for(let i=0;i<4;i++)await Promise.resolve();
 x.setUid('anotherowneruid00003');
 release();
 await assert.rejects(pending,/UNAVAILABLE/);
 x.setUid(null);
 await assert.rejects(x.transport.emergencyStop(PEER),/UNAVAILABLE/);
});
test('client sharing status becomes OFF only after explicit verified emergency acknowledgement',async()=>{
 const phases=[];
 const controller=createForegroundSharingController({
   ownerUid:()=>SELF,
   isForeground:()=>true,
   askForegroundPermission:async()=>true,
   watchForegroundFix:async()=>({remove:()=>{}}),
   now:Date.now,
   schedule:()=>({}),cancel:()=>{},
   onState:s=>phases.push(s.phase),
   transport:{
     start:async()=>({enabled:true,expiresAtMs:Date.now()+50_000}),
     publish:async()=>({stored:true,expiresAtMs:Date.now()+20_000}),
     stop:async()=>{throw Error('network disconnected');}
   }
 });
 const relation={senderUid:SELF,recipientUid:PEER,status:'accepted',
   senderConsent:true,recipientConsent:true};
 await controller.start(PEER,relation);
 assert.equal(controller.getState().phase,'sharing');
 await controller.stop();
 assert.equal(controller.getState().phase,'stop-unconfirmed');
 controller.acknowledgeEmergencyStop('unrelatedpeeruid0003');
 assert.equal(controller.getState().phase,'stop-unconfirmed');
 controller.acknowledgeEmergencyStop(PEER);
 assert.equal(controller.getState().phase,'off');
 assert.ok(phases.includes('stop-unconfirmed'));
 assert.equal(phases.at(-1),'off');
 controller.dispose();
});
test('Android has explicit per-known-friend revoke even after consent change; iOS remains deferred',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const screen=read('src/location/M2SharingPanel.tsx');
 const transport=read('src/location/m2StagingTransport.ts');
 const coordinator=read('src/location/m2ForegroundSession.ts');
 const native=read('.github/workflows/android-m2-native-staging-apk.yml');
 assert.match(screen,/Platform\.OS==='android'/);
 assert.match(screen,/transport\.emergencyStop!/);
 assert.match(screen,/account\.current!==actor/);
 assert.match(screen,/r\.senderUid===actor&&r\.recipientUid===peerUid/);
 assert.match(screen,/acknowledgeEmergencyStop\(peerUid\)/);
 assert.match(screen,/status:'confirmed'/);
 assert.match(screen,/status:'failed'/);
 assert.match(coordinator,/state\.phase==='stop-unconfirmed'/);
 assert.match(transport,/\/v1\/locations\/grants\/stop/);
 assert.doesNotMatch(native,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS/);
});

test('owner STOP waits for an in-flight START and prevents a late v1/v2 location grant',async()=>{
 for(const v2 of [false,true]){
   let release,seen;
   const gate=new Promise(resolve=>{release=resolve;});
   const started=new Promise(resolve=>{seen=resolve;});
   const paths=[];
   const transport=createM2StagingTransport({
     approvedCloudRunUrl:ORIGIN,projectId:'heremate',useDeviceSessions:v2,
     currentIdentity:()=>({uid:SELF,getIdToken:async()=>TOKEN}),
     isForeground:()=>true,foregroundPermissionGranted:async()=>true,
     fetchImpl:async(url)=>{
       const path=new URL(url).pathname;
       paths.push(path);
       if(path.endsWith('/start')){
         seen();
         await gate;
         return {ok:true,status:200,json:async()=>v2?
           {enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP}:
           {enabled:true,expiresAtMs:Date.now()+50_000}};
       }
       if(path==='/v1/locations/grants/stop')
         return {ok:true,status:200,json:async()=>({enabled:false})};
       throw Error('unexpected_request');
     }
   });
   const pendingStart=transport.start(PEER);
   await started;
   const stop=transport.emergencyStop(PEER);
   await assert.rejects(transport.start(PEER),/UNAVAILABLE/,
     'cannot reactivate while owner STOP is pending');
   await assert.rejects(transport.emergencyStop(PEER),/UNAVAILABLE/,
     'cannot issue duplicate STOP during serialized operation');
   assert.equal(paths.length,1,'STOP must not run before the START response');
   release();
   await pendingStart;
   assert.deepEqual(await stop,{enabled:false});
   assert.deepEqual(paths,[v2?'/v2/locations/sessions/start':
     '/v1/locations/grants/start','/v1/locations/grants/stop']);
   if(v2){
     await assert.rejects(transport.stop(PEER),/UNAVAILABLE/);
     await assert.rejects(transport.publish(PEER,{
       latitude:0,longitude:0,accuracyMeters:5,capturedAtMs:Date.now()-50
     }),/UNAVAILABLE/);
   }
 }
});
test('failed pending START cannot suppress an independent owner STOP',async()=>{
 let release,seen;
 const waiting=new Promise(resolve=>{release=resolve;});
 const started=new Promise(resolve=>{seen=resolve;});
 const paths=[];
 const transport=createM2StagingTransport({
   approvedCloudRunUrl:ORIGIN,projectId:'heremate',useDeviceSessions:true,
   currentIdentity:()=>({uid:SELF,getIdToken:async()=>TOKEN}),
   isForeground:()=>true,foregroundPermissionGranted:async()=>true,
   fetchImpl:async(url)=>{
     const path=new URL(url).pathname;paths.push(path);
     if(path==='/v2/locations/sessions/start'){
       seen();await waiting;
       return {ok:false,status:503,json:async()=>({})};
     }
     return {ok:true,status:200,json:async()=>({enabled:false})};
   }
 });
 const start=transport.start(PEER);
 await started;
 const stop=transport.emergencyStop(PEER);
 release();
 await assert.rejects(start,/UNAVAILABLE/);
 assert.deepEqual(await stop,{enabled:false});
 assert.deepEqual(paths,[
   '/v2/locations/sessions/start','/v1/locations/grants/stop'
 ]);
});
