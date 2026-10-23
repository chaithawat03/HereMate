/**
 * Offline Android M3/M4 transport race tests. No real JWT, device GPS, GCP
 * network or permission prompt. The injected permission promise is held at
 * each of three awaits: before token, immediately before POST and after JSON.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createM2StagingTransport,APPROVED_M2_STAGING_ORIGINS}
 from '../src/location/m2StagingTransport.ts';
import {createM4StagingTransport,APPROVED_M4_STAGING_ORIGINS}
 from '../src/geofences/m4StagingTransport.ts';

const A='syntheticandroiduid0001',B='syntheticpeeruid00002';
const C='differentandroiduid003',TOKEN='synthetic-token-'.repeat(5);
function permissionGate(blockAt){
 let calls=0,release,entered;
 const held=new Promise(resolve=>{release=resolve;});
 const reached=new Promise(resolve=>{entered=resolve;});
 return {
  permission:async()=>{
   ++calls;
   if(calls===blockAt){entered();await held;}
   return true;
  },
  reached,release:()=>release(),calls:()=>calls
 };
}
function harness(kind,stage){
 const gate=permissionGate(stage);
 let uid=A,foreground=true;
 const requests=[];
 const currentIdentity=()=>uid?{uid,getIdToken:async()=>TOKEN}:null;
 const common={
  projectId:'heremate',currentIdentity,
  isForeground:()=>foreground,
  foregroundPermissionGranted:gate.permission,
  fetchImpl:async(url,options)=>{
   requests.push({url,options});
   const reply=kind==='m3'?
    {point:{latitude:0,longitude:0,accuracyMeters:12,
      capturedAtMs:Date.now()-100},expiresAtMs:Date.now()+15_000}:
    {evaluated:true,event:'enter',quality:'ok'};
   return {ok:true,status:200,json:async()=>reply};
  }
 };
 const transport=kind==='m3'?
  createM2StagingTransport({...common,
   approvedCloudRunUrl:APPROVED_M2_STAGING_ORIGINS[1],
   useDeviceSessions:true}):
  createM4StagingTransport({...common,
   approvedCloudRunUrl:APPROVED_M4_STAGING_ORIGINS[1]});
 const action=()=>kind==='m3'?transport.read(B):transport.evaluate(B,{
  latitude:0,longitude:0,accuracyMeters:12,capturedAtMs:Date.now()-100
 });
 return {gate,requests,action,setUid:x=>{uid=x;},
  setForeground:x=>{foreground=x;}};
}
for(const kind of ['m3','m4']){
 test(kind+' valid foreground/account remains allowed through all three OS permission awaits',async()=>{
  // A gate at stage 4 never blocks: confirms each of the three checkpoints.
  const x=harness(kind,4);
  const result=await x.action();
  assert.equal(x.gate.calls(),3);
  assert.equal(x.requests.length,1);
  assert.equal(x.requests[0].options.redirect,'error');
  assert.ok(kind==='m3'?result.point.latitude===0:result.event==='enter');
 });
 for(const stage of [1,2,3]){
  for(const incident of ['identity','background']){
   test(kind+' permission await '+stage+' denies silent '+incident+
     ' transition without disclosing private result',async()=>{
    const x=harness(kind,stage);
    const pending=x.action();
    await x.gate.reached;
    if(incident==='identity')x.setUid(C);
    else x.setForeground(false);
    x.gate.release();
    await assert.rejects(pending,kind==='m3'?
      /M2_LOCATION_TRANSPORT_UNAVAILABLE/:/M4_GEOFENCE_NOT_AVAILABLE/);
    assert.equal(x.requests.length,stage===3?1:0,
      'No private request may be sent after preflight account/background change');
    if(stage===3)assert.equal(x.gate.calls(),3,
      'A post-JSON permission race must suppress the returned private payload');
   });
  }
 }
}
