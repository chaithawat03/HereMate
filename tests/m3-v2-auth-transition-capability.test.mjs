/** M3 v2 Firebase account transitions must erase local device capabilities.
 * Offline synthetic bearer, no real GPS, Firebase credentials or deployments.
 * Local invalidation is NEVER proof that a remote publisher lease was stopped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createM2StagingTransport} from '../src/location/m2StagingTransport.ts';

const FIRST='firstowneruid00000001',SECOND='secondowneruid0000002';
const PEER='acceptedviewer00000003',JWT='T'.repeat(80);
const CAP_A='a'.repeat(64),CAP_B='b'.repeat(64);
const ORIGIN='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
const fix=()=>({latitude:13.7,longitude:100.5,accuracyMeters:10,
 capturedAtMs:Date.now()-100});
function rig(fetchOverride){
 let who=FIRST;
 const calls=[];
 const fetchImpl=async(url,options)=>{
   const endpoint=new URL(url).pathname;
   const body=JSON.parse(options.body);
   calls.push({endpoint,body,who});
   if(fetchOverride)return fetchOverride({endpoint,body,who});
   const row=endpoint.endsWith('/start')
     ?{enabled:true,expiresAtMs:Date.now()+50_000,
       sessionToken:who===FIRST?CAP_A:CAP_B}
     :endpoint.endsWith('/publish')
       ?{stored:true,expiresAtMs:Date.now()+20_000}
       :{enabled:false};
   return {ok:true,status:200,json:async()=>row};
 };
 const transport=createM2StagingTransport({
   approvedCloudRunUrl:ORIGIN,projectId:'heremate',
   useDeviceSessions:true,
   currentIdentity:()=>who?{uid:who,getIdToken:async()=>JWT}:null,
   isForeground:()=>true,
   foregroundPermissionGranted:async()=>true,
   fetchImpl
 });
 return {transport,calls,setUser:next=>{who=next;}};
}
test('M3 account-change listener purges old capability locally without sending or ACKing STOP',async()=>{
 const x=rig();
 await x.transport.start(PEER);
 assert.equal(x.calls.length,1);
 x.setUser(SECOND);
 assert.equal(x.transport.invalidateDeviceSession(),undefined);
 assert.equal(x.calls.length,1,'local erasure must not pretend to revoke a remote lease');
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
 await assert.rejects(x.transport.stop(PEER),/UNAVAILABLE/);
 assert.equal(x.calls.length,1);
 // Backend may still deny a new START until the original remote 60s TTL;
 // this mock represents the subsequent server-authorized attempt.
 assert.equal((await x.transport.start(PEER)).enabled,true);
 await x.transport.publish(PEER,fix());
 assert.equal(x.calls.at(-1).body.sessionToken,CAP_B);
 assert.notEqual(x.calls.at(-1).body.sessionToken,CAP_A);
 await x.transport.stop(PEER);
 assert.equal(x.calls.at(-1).body.sessionToken,CAP_B);
});
test('M3 delayed Firebase auth observer cannot leave another account blocked by stale token',async()=>{
 const x=rig();
 await x.transport.start(PEER);
 x.setUser(SECOND);
 // No explicit listener call: the next operation must still purge the
 // foreign UID's cached session and rely on backend lease authorization.
 assert.equal((await x.transport.start(PEER)).enabled,true);
 await x.transport.publish(PEER,fix());
 assert.equal(x.calls.at(-1).body.sessionToken,CAP_B);
});
test('M3 auth transition during delayed START cannot resurrect retired capability',async()=>{
 let release,seen;
 const gate=new Promise(resolve=>{release=resolve;});
 const started=new Promise(resolve=>{seen=resolve;});
 const x=rig(async({endpoint,who})=>{
   if(endpoint.endsWith('/start')&&who===FIRST){
     seen();
     await gate;
     return {ok:true,status:200,json:async()=>({
       enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP_A
     })};
   }
   return {ok:true,status:200,json:async()=>({
     enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP_B
   })};
 });
 const first=x.transport.start(PEER);
 await started;
 x.setUser(SECOND);
 x.transport.invalidateDeviceSession();
 release();
 await assert.rejects(first,/UNAVAILABLE/);
 assert.equal((await x.transport.start(PEER)).enabled,true);
 await x.transport.publish(PEER,fix()).catch(()=>{});
 // No retired A capability may ever be emitted in a second-account request.
 assert.ok(x.calls.filter(c=>c.who===SECOND)
   .every(c=>c.body.sessionToken!==CAP_A));
});
test('M3 sharing UI erases v2 token on auth change and auth-state error',()=>{
 const ui=readFileSync(new URL('../src/location/M2SharingPanel.tsx',import.meta.url),'utf8');
 const transport=readFileSync(new URL('../src/location/m2StagingTransport.ts',import.meta.url),'utf8');
 assert.match(ui,/account\.current=uid;[\s\S]*?ctrl\.accountChanged\(\);[\s\S]*?transport\.invalidateDeviceSession\?\.\(\)/);
 assert.match(ui,/account\.current=null;[\s\S]*?ctrl\.accountChanged\(\);[\s\S]*?transport\.invalidateDeviceSession\?\.\(\)/);
 assert.match(transport,/forgetForeignDeviceSession/);
 assert.match(transport,/invalidateDeviceSession\(\)/);
});
