/**
 * Dormant M4 trusted-server transition-state integrity, synthetic inputs only.
 * No mobile GPS, Firestore credentials, deployed route or location history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeofenceService,GeofenceDenied}
 from '../backend/geofences/geofence-service.mjs';
import {STAGING_PROJECT} from '../backend/location/location-service.mjs';
import {advanceState} from '../backend/geofences/geofence-policy.mjs';

const NOW=1_800_000_000_000;
const OWNER='zoneowner000000001',SUBJECT='zonesubject00000002';
const REV='1800000000:0',AUTH='synthetic-identity-token-'.repeat(3);
const CIRCLE={latitude:0,longitude:0,radiusMeters:350};
const FIX={latitude:0,longitude:0,accuracyMeters:12,capturedAtMs:NOW-100};
const relation={senderUid:OWNER,recipientUid:SUBJECT,status:'accepted',
 senderConsent:true,recipientConsent:true,
 updatedAt:{seconds:1800000000,nanoseconds:0}};
const zone={ownerUid:OWNER,subjectUid:SUBJECT,status:'active',
 relationRevision:REV,approvedAtMs:NOW-50_000,
 expiresAtMs:NOW+120_000,circle:CIRCLE};
const grant={ownerUid:SUBJECT,viewerUid:OWNER,enabled:true,
 relationRevision:REV,expiresAtMs:NOW+50_000};
const publisher={ownerUid:SUBJECT,viewerUid:OWNER,expiresAtMs:NOW+50_000};
const baseState={ownerUid:OWNER,subjectUid:SUBJECT,
 relationRevision:REV,approvedAtMs:zone.approvedAtMs,
 expiresAtMs:NOW+100_000,zone:'outside',pending:'inside',streak:1,
 lastEventAtMs:NOW-1000,lastSampleCapturedAtMs:NOW-1200};

function harness(state){
 const writes=[];
 const store={projectId:STAGING_PROJECT,
  async transactZone(pair,work){
   assert.deepEqual(pair,{ownerUid:OWNER,subjectUid:SUBJECT});
   const staged=[];
   const result=await work({
    relation,zone,state,grant,publisher,
    setState:row=>staged.push(['setState',row]),
    deleteState:()=>staged.push(['deleteState']),
    deleteZone:()=>staged.push(['deleteZone'])
   });
   writes.push(...staged);
   return result;
  }
 };
 const adminAuth={app:{options:{projectId:STAGING_PROJECT}},
  async verifyIdToken(token,revoked){
   assert.equal(token,AUTH);assert.equal(revoked,true);
   return {uid:SUBJECT,sub:SUBJECT,aud:STAGING_PROJECT,
    iss:'https://securetoken.google.com/'+STAGING_PROJECT};
  }
 };
 return {writes,service:createGeofenceService({adminAuth,store,
  rateLimiter:{persistent:true,consume:async()=>true},clock:()=>NOW})};
}
const evaluate=service=>service.evaluate({
 idToken:AUTH,ownerUid:OWNER,point:FIX,
 appInForeground:true,foregroundPermissionGranted:true
});

test('reproduction: malformed cooldown previously yielded an Enter from one fix',()=>{
 const corrupt={...baseState,lastEventAtMs:'invalid'};
 const result=advanceState(CIRCLE,FIX,NOW,corrupt);
 assert.equal(result.event,'enter',
  'baseline demonstrates why malformed persisted cooldown cannot be reset silently');
});

test('valid trusted dedupe record keeps its 5-minute cooldown',async()=>{
 const x=harness({...baseState});
 const result=await evaluate(x.service);
 assert.deepEqual(result,{evaluated:true,event:null,quality:'ok'});
 assert.equal(x.writes.length,1);
 const next=x.writes[0][1];
 assert.equal(next.zone,'inside');
 assert.equal(next.lastEventAtMs,NOW-1000);
 for(const forbidden of ['latitude','longitude','point','fix','history'])
  assert.equal(Object.hasOwn(next,forbidden),false);
});

test('malformed same-pair dedupe records fail closed without a state mutation',async()=>{
 const corrupt=[
  {...baseState,lastEventAtMs:'invalid'},
  {...baseState,lastEventAtMs:NaN},
  {...baseState,lastEventAtMs:NOW+1},
  {...baseState,lastSampleCapturedAtMs:'invalid'},
  {...baseState,lastSampleCapturedAtMs:NOW+6000},
  {...baseState,lastSampleCapturedAtMs:null},
  {...baseState,expiresAtMs:String(NOW+100_000)},
  {...baseState,expiresAtMs:NOW+500_000},
  {...baseState,expiresAtMs:NaN},
  {...baseState,zone:'inside',pending:'inside'},
  {...baseState,streak:2},
  {...baseState,pending:null,streak:1},
  {...baseState,zone:'nonsense'},
  {...baseState,ownerUid:'otherzoneowner0001'}
 ];
 for(const state of corrupt){
  const x=harness(state);
  await assert.rejects(evaluate(x.service),GeofenceDenied);
  assert.deepEqual(x.writes,[],'invalid state must not create a notification or overwrite dedupe');
 }
});

test('expired or superseded same-pair state resets to baseline without Enter/Exit',async()=>{
 for(const state of [
  {...baseState,expiresAtMs:NOW-1},
  {...baseState,relationRevision:'old:1'},
  {...baseState,approvedAtMs:zone.approvedAtMs-1}
 ]){
  const x=harness(state);
  const result=await evaluate(x.service);
  assert.equal(result.event,null);
  assert.equal(x.writes.length,1);
  assert.equal(x.writes[0][1].zone,'unknown');
  assert.equal(x.writes[0][1].pending,'inside');
 }
});

test('subject can independently revoke malformed dedupe state without consent checks',async()=>{
 const x=harness({...baseState,lastEventAtMs:'invalid'});
 assert.deepEqual(await x.service.revoke({
  idToken:AUTH,ownerUid:OWNER,subjectUid:SUBJECT
 }),{revoked:true});
 assert.deepEqual(x.writes.map(row=>row[0]),['deleteZone','deleteState']);
});
