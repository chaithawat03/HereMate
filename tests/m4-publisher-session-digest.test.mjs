/** Offline M4/M3 publisher-lease integrity regression.
 * Synthetic 0,0 fixes; no Android hardware, cloud credentials, or GPS history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGeofenceService,GeofenceDenied} from '../backend/geofences/geofence-service.mjs';
import {STAGING_PROJECT} from '../backend/location/location-service.mjs';

const NOW=1_800_000_000_000;
const OWNER='zoneowner000000001',SUBJECT='subject0000000001';
const RELATION_REVISION='1800000000:0';
const TOKEN_A='a'.repeat(64),TOKEN_B='b'.repeat(64);
const digest=secret=>createHash('sha256')
 .update('m3-device-session:v1:'+secret).digest('hex');
const DIGEST_A=digest(TOKEN_A),DIGEST_B=digest(TOKEN_B);
const FIX={latitude:0,longitude:0,accuracyMeters:12,capturedAtMs:NOW-1000};
const token=uid=>'T'.repeat(64)+uid;
const relation={senderUid:OWNER,recipientUid:SUBJECT,status:'accepted',
  senderConsent:true,recipientConsent:true,
  updatedAt:{seconds:1800000000,nanoseconds:0}};
const zone={ownerUid:OWNER,subjectUid:SUBJECT,status:'active',
  // Valid server-created approval chronology is required by pending PR #116.
  relationRevision:RELATION_REVISION,createdAtMs:NOW-2000,approvedAtMs:NOW-1000,
  expiresAtMs:NOW+60_000,
  circle:{latitude:0,longitude:0,radiusMeters:350}};
const baseGrant={ownerUid:SUBJECT,viewerUid:OWNER,enabled:true,
  relationRevision:RELATION_REVISION,expiresAtMs:NOW+50_000};
const basePublisher={ownerUid:SUBJECT,viewerUid:OWNER,expiresAtMs:NOW+50_000};

function rig(grant,publisher,initialState=null){
  const writes=[];
  let state=initialState;
  const store={
    projectId:STAGING_PROJECT,
    async transactZone({ownerUid,subjectUid},work){
      assert.equal(ownerUid,OWNER);
      assert.equal(subjectUid,SUBJECT);
      const pending=[];
      const result=await work({
        relation,zone,state,grant,publisher,
        setState:row=>pending.push(row),
        deleteState:()=>pending.push(null)
      });
      writes.push(...pending);
      if(pending.length)state=pending.at(-1);
      return result;
    }
  };
  const adminAuth={
    app:{options:{projectId:STAGING_PROJECT}},
    async verifyIdToken(value,revoked){
      assert.equal(revoked,true);
      assert.equal(value,token(SUBJECT));
      return {uid:SUBJECT,sub:SUBJECT,aud:STAGING_PROJECT,
        iss:'https://securetoken.google.com/'+STAGING_PROJECT};
    }
  };
  return {
    writes,currentState:()=>state,
    service:createGeofenceService({adminAuth,store,
      rateLimiter:{persistent:true,consume:async()=>true},clock:()=>NOW})
  };
}
const evaluate=(service,sessionToken,point=FIX)=>service.evaluate({
  idToken:token(SUBJECT),ownerUid:OWNER,point,
  ...(sessionToken===undefined?{}:{sessionToken}),
  appInForeground:true,foregroundPermissionGranted:true
});

test('M4 permits legacy v1 same-pair active publisher with neither session digest',async()=>{
  const x=rig({...baseGrant},{...basePublisher});
  const result=await evaluate(x.service);
  assert.equal(result.evaluated,true);
  assert.equal(result.event,null);
  assert.equal(x.writes.length,1);
  for(const key of ['latitude','longitude','point','history'])
    assert.equal(Object.hasOwn(x.writes[0],key),false);
});

test('M4 permits a matching well-formed M3 session digest without storing GPS history',async()=>{
  const x=rig({...baseGrant,sessionDigest:DIGEST_A},
    {...basePublisher,sessionDigest:DIGEST_A});
  assert.equal((await evaluate(x.service,TOKEN_A)).evaluated,true);
  assert.equal(x.writes.length,1);
  assert.equal(Object.hasOwn(x.writes[0],'point'),false);
});

test('M4 denies a second same-Firebase-UID device without the active M3 publisher capability',async()=>{
 const x=rig({...baseGrant,sessionDigest:DIGEST_A},
   {...basePublisher,sessionDigest:DIGEST_A});
 // Firebase ID token and foreground flags alone are not publisher proof.
 for(const wrong of [undefined,TOKEN_B,'0'.repeat(64),'bad',null,'A'.repeat(64)]){
   await assert.rejects(evaluate(x.service,wrong),GeofenceDenied);
   assert.deepEqual(x.writes,[],'unauthorized handset cannot update dedupe state');
 }
 assert.equal((await evaluate(x.service,TOKEN_A)).evaluated,true);
 assert.equal(x.writes.length,1);
 assert.equal(JSON.stringify(x.writes).includes(TOKEN_A),false,
   'never store device bearer capability in M4 state');
});

test('M4 v1 cannot be confused with v2 by adding a capability to a legacy lease',async()=>{
 const x=rig({...baseGrant},{...basePublisher});
 await assert.rejects(evaluate(x.service,TOKEN_A),GeofenceDenied);
 assert.deepEqual(x.writes,[]);
 assert.equal((await evaluate(x.service)).evaluated,true);
});

test('M4 rejects cross-session M3 grant/publisher mismatch before writing state',async()=>{
  const cases=[
    [{...baseGrant,sessionDigest:DIGEST_A},
      {...basePublisher,sessionDigest:DIGEST_B}],
    [{...baseGrant,sessionDigest:DIGEST_A},{...basePublisher}],
    [{...baseGrant},{...basePublisher,sessionDigest:DIGEST_A}],
    [{...baseGrant,sessionDigest:'not-a-digest'},
      {...basePublisher,sessionDigest:'not-a-digest'}],
    [{...baseGrant,sessionDigest:null},
      {...basePublisher,sessionDigest:null}],
    [{...baseGrant,sessionDigest:''},{...basePublisher,sessionDigest:''}]
  ];
  for(const [grant,publisher] of cases){
    const x=rig(grant,publisher);
    await assert.rejects(evaluate(x.service),GeofenceDenied);
    assert.deepEqual(x.writes,[],'invalid publisher lease must not update geofence state');
  }
});

test('M4 still rejects expired M2/M3 publisher lease even with matching digest',async()=>{
  const x=rig({...baseGrant,sessionDigest:DIGEST_A,expiresAtMs:NOW-1},
    {...basePublisher,sessionDigest:DIGEST_A,expiresAtMs:NOW-1});
  await assert.rejects(evaluate(x.service),GeofenceDenied);
  assert.deepEqual(x.writes,[]);
});

test('M4 v2 rejects fresh-but-pre-START GPS without state or event mutation',async()=>{
 const x=rig({...baseGrant,sessionDigest:DIGEST_A},
   {...basePublisher,sessionDigest:DIGEST_A});
 // This v2 lease was issued at NOW-10s, despite a 30s generic fix window.
 for(const capturedAtMs of [NOW-29_000,NOW-10_001]){
   await assert.rejects(evaluate(x.service,TOKEN_A,{
     ...FIX,capturedAtMs
   }),GeofenceDenied);
   assert.deepEqual(x.writes,[]);
 }
 assert.equal((await evaluate(x.service,TOKEN_A,{
   ...FIX,capturedAtMs:NOW-10_000
 })).evaluated,true,'lease-start boundary remains allowed');
 assert.equal((await evaluate(x.service,TOKEN_A,FIX)).evaluated,true);
 assert.equal(x.writes.length,2);
 for(const row of x.writes){
   for(const key of ['point','latitude','longitude','history','sessionToken'])
     assert.equal(Object.hasOwn(row,key),false);
 }
 const legacy=rig({...baseGrant},{...basePublisher});
 assert.equal((await evaluate(legacy.service,undefined,{
   ...FIX,capturedAtMs:NOW-29_000
 })).evaluated,true,'M2 v1 generic freshness policy is unchanged');
});

test('M4 v2 rejects post-expiry captured GPS within generic 5s clock skew',async()=>{
 const expiresAtMs=NOW+1000;
 const grant={...baseGrant,expiresAtMs,sessionDigest:DIGEST_A};
 const publisher={...basePublisher,expiresAtMs,sessionDigest:DIGEST_A};
 const x=rig(grant,publisher);
 // The 1ms future-skewed fix is not expired at request time, but its
 // capture timestamp is outside the current publisher's consented lease.
 for(const capturedAtMs of [expiresAtMs+1,expiresAtMs+1000]){
   await assert.rejects(evaluate(x.service,TOKEN_A,{
     ...FIX,capturedAtMs
   }),GeofenceDenied);
   assert.deepEqual(x.writes,[],
     'no geofence baseline, cooldown or event writes after lease end');
 }
 const boundary=await evaluate(x.service,TOKEN_A,{
   ...FIX,capturedAtMs:expiresAtMs
 });
 assert.equal(boundary.evaluated,true,'lease-end capture is valid');
 const original=structuredClone(x.currentState());
 await assert.rejects(evaluate(x.service,TOKEN_A,{
   ...FIX,capturedAtMs:expiresAtMs+1
 }),GeofenceDenied);
 assert.deepEqual(x.currentState(),original,
   'post-expiry fix must not mutate an existing approved-zone state');
 // Original M2/v1 remains governed by the existing generic skew tolerance.
 const legacy=rig({...baseGrant,expiresAtMs},{...basePublisher,expiresAtMs});
 assert.equal((await evaluate(legacy.service,undefined,{
   ...FIX,capturedAtMs:expiresAtMs+1
 })).evaluated,true);
});

test('M4 v2 device lease handoff discards prior handset geofence baseline without a false EXIT',async()=>{
 const prior={ownerUid:OWNER,subjectUid:SUBJECT,
   relationRevision:RELATION_REVISION,approvedAtMs:zone.approvedAtMs,
   expiresAtMs:NOW+40_000,zone:'inside',pending:null,streak:0,
   lastEventAtMs:null,lastSampleCapturedAtMs:NOW-4000,
   sessionDigest:DIGEST_A};
 const x=rig({...baseGrant,sessionDigest:DIGEST_B},
   {...basePublisher,sessionDigest:DIGEST_B},prior);
 const outside={latitude:0.01,longitude:0,accuracyMeters:10,
   capturedAtMs:NOW-2000};
 const first=await evaluate(x.service,TOKEN_B,outside);
 assert.equal(first.event,null,'new device first fix is baseline only');
 assert.equal(x.currentState().zone,'unknown');
 assert.equal(x.currentState().pending,'outside');
 assert.equal(x.currentState().sessionDigest,DIGEST_B);
 const second=await evaluate(x.service,TOKEN_B,{
   ...outside,capturedAtMs:NOW-500
 });
 assert.equal(second.event,null,'new device second fix establishes baseline, not EXIT');
 assert.equal(x.currentState().zone,'outside');
 assert.equal(x.currentState().sessionDigest,DIGEST_B);
 assert.equal(x.writes.length,2);
 for(const row of x.writes){
   for(const forbidden of ['point','latitude','longitude','history','sessionToken'])
     assert.equal(Object.hasOwn(row,forbidden),false);
   assert.equal(JSON.stringify(row).includes(TOKEN_B),false,
     'device bearer capability is never persisted');
 }
});

test('M4 v2 same-lease state continues its transition; v1 state remains compatible',async()=>{
 const prior={ownerUid:OWNER,subjectUid:SUBJECT,
   relationRevision:RELATION_REVISION,approvedAtMs:zone.approvedAtMs,
   expiresAtMs:NOW+40_000,zone:'inside',pending:null,streak:0,
   lastEventAtMs:null,lastSampleCapturedAtMs:NOW-4000};
 const outside={latitude:0.01,longitude:0,accuracyMeters:10,
   capturedAtMs:NOW-2000};
 for(const useV2 of [false,true]){
   const state=useV2?{...prior,sessionDigest:DIGEST_A}:prior;
   const grant=useV2?{...baseGrant,sessionDigest:DIGEST_A}:{...baseGrant};
   const publisher=useV2?{...basePublisher,sessionDigest:DIGEST_A}:{...basePublisher};
   const x=rig(grant,publisher,state);
   assert.equal((await evaluate(x.service,useV2?TOKEN_A:undefined,outside)).event,null);
   const second=await evaluate(x.service,useV2?TOKEN_A:undefined,{
     ...outside,capturedAtMs:NOW-500
   });
   assert.equal(second.event,'exit','same lease must preserve existing dedupe behavior');
   assert.equal(x.currentState().zone,'outside');
   assert.equal(Object.hasOwn(x.currentState(),'sessionDigest'),useV2);
 }
});

test('M4 v1 never inherits v2 geofence baseline when the device lease downgrades',async()=>{
 const prior={ownerUid:OWNER,subjectUid:SUBJECT,
   relationRevision:RELATION_REVISION,approvedAtMs:zone.approvedAtMs,
   expiresAtMs:NOW+40_000,zone:'inside',pending:null,streak:0,
   lastEventAtMs:null,lastSampleCapturedAtMs:NOW-4000,
   sessionDigest:DIGEST_A};
 const x=rig({...baseGrant},{...basePublisher},prior);
 const first=await evaluate(x.service,undefined,{
   latitude:0.01,longitude:0,accuracyMeters:10,capturedAtMs:NOW-2000
 });
 assert.equal(first.event,null);
 assert.equal(x.currentState().zone,'unknown');
 assert.equal(Object.hasOwn(x.currentState(),'sessionDigest'),false);
});

test('M4 device handoff resets location baseline but preserves approved-zone event cooldown',async()=>{
 const outside={latitude:0.01,longitude:0,accuracyMeters:10};
 const inside={latitude:0,longitude:0,accuracyMeters:10};
 for(const [priorEvent,expectEnter] of [
   [NOW-1000,null],[NOW-300_001,'enter']
 ]){
   const prior={ownerUid:OWNER,subjectUid:SUBJECT,
     relationRevision:RELATION_REVISION,approvedAtMs:zone.approvedAtMs,
     expiresAtMs:NOW+40_000,zone:'inside',pending:null,streak:0,
     lastEventAtMs:priorEvent,lastSampleCapturedAtMs:NOW-4000,
     sessionDigest:DIGEST_A};
   const x=rig({...baseGrant,sessionDigest:DIGEST_B},
     {...basePublisher,sessionDigest:DIGEST_B},prior);
   // First two observations on handset B establish its OWN outside baseline.
   assert.equal((await evaluate(x.service,TOKEN_B,{
     ...outside,capturedAtMs:NOW-2000})).event,null);
   assert.equal(x.currentState().zone,'unknown');
   assert.equal(x.currentState().lastEventAtMs,priorEvent,
     'lease change must not erase the per-zone cooldown timestamp');
   assert.equal((await evaluate(x.service,TOKEN_B,{
     ...outside,capturedAtMs:NOW-500})).event,null);
   assert.equal(x.currentState().zone,'outside');
   // Even after two valid inside fixes, a recent A event must still suppress
   // the duplicate Enter on B; an already-expired cooldown must not block it.
   assert.equal((await evaluate(x.service,TOKEN_B,{
     ...inside,capturedAtMs:NOW+700})).event,null);
   assert.equal((await evaluate(x.service,TOKEN_B,{
     ...inside,capturedAtMs:NOW+2000})).event,expectEnter);
   assert.equal(x.currentState().zone,'inside');
   assert.equal(x.currentState().lastEventAtMs,
     expectEnter===null?priorEvent:NOW);
   assert.equal(x.currentState().sessionDigest,DIGEST_B);
 }
});

test('M4 lease handoff denies malformed old-device event cooldown without writes',async()=>{
 for(const bad of ['invalid',NaN,NOW+1,0,1.5]){
   const prior={ownerUid:OWNER,subjectUid:SUBJECT,
     relationRevision:RELATION_REVISION,approvedAtMs:zone.approvedAtMs,
     expiresAtMs:NOW+40_000,zone:'inside',pending:null,streak:0,
     lastEventAtMs:bad,lastSampleCapturedAtMs:NOW-4000,
     sessionDigest:DIGEST_A};
   const x=rig({...baseGrant,sessionDigest:DIGEST_B},
     {...basePublisher,sessionDigest:DIGEST_B},prior);
   await assert.rejects(evaluate(x.service,TOKEN_B),GeofenceDenied);
   assert.deepEqual(x.writes,[]);
 }
});
