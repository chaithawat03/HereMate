/** M4 dormant server-only zone approval chronology; synthetic identities only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeofenceService,GeofenceDenied}
  from '../backend/geofences/geofence-service.mjs';
import {STAGING_PROJECT} from '../backend/location/location-service.mjs';
import {MAX_ZONE_LIFETIME_MS,PENDING_LIFETIME_MS}
  from '../backend/geofences/geofence-policy.mjs';

const NOW=1_800_000_000_000;
const OWNER='zoneowner000000001',SUBJECT='zonesubject00000002';
const TOKEN='synthetic-auth-token-'.repeat(3);
const REV='1800000000:0';
const CIRCLE={latitude:0,longitude:0,radiusMeters:350};
const relation={senderUid:OWNER,recipientUid:SUBJECT,status:'accepted',
  senderConsent:true,recipientConsent:true,
  updatedAt:{seconds:1800000000,nanoseconds:0}};
const created=NOW-90_000,approved=NOW-30_000;
const pending={ownerUid:OWNER,subjectUid:SUBJECT,status:'pending',
  relationRevision:REV,createdAtMs:created,
  expiresAtMs:created+PENDING_LIFETIME_MS,circle:CIRCLE};
const active={...pending,status:'active',approvedAtMs:approved,
  expiresAtMs:approved+MAX_ZONE_LIFETIME_MS};
const grant={ownerUid:SUBJECT,viewerUid:OWNER,enabled:true,
  relationRevision:REV,expiresAtMs:NOW+50_000};
const publisher={ownerUid:SUBJECT,viewerUid:OWNER,expiresAtMs:NOW+50_000};
const FIX={latitude:0,longitude:0,accuracyMeters:12,capturedAtMs:NOW-100};

function harness(zone){
 const writes=[];
 const store={projectId:STAGING_PROJECT,async transactZone(pair,work){
   assert.deepEqual(pair,{ownerUid:OWNER,subjectUid:SUBJECT});
   const staged=[];
   const result=await work({relation,zone,state:null,grant,publisher,
     setState:row=>staged.push(['setState',row]),
     setZone:row=>staged.push(['setZone',row]),
     deleteState:()=>staged.push(['deleteState']),
     deleteZone:()=>staged.push(['deleteZone'])});
   writes.push(...staged);
   return result;
 }};
 const adminAuth={app:{options:{projectId:STAGING_PROJECT}},
   async verifyIdToken(token,checkRevoked){
     assert.equal(token,TOKEN);assert.equal(checkRevoked,true);
     return {uid:SUBJECT,sub:SUBJECT,aud:STAGING_PROJECT,
       iss:'https://securetoken.google.com/'+STAGING_PROJECT};
   }};
 const service=createGeofenceService({adminAuth,store,
   rateLimiter:{persistent:true,consume:async()=>true},clock:()=>NOW});
 return {service,writes};
}
const review=s=>s.review({idToken:TOKEN,ownerUid:OWNER});
const evaluate=s=>s.evaluate({idToken:TOKEN,ownerUid:OWNER,point:FIX,
  appInForeground:true,foregroundPermissionGranted:true});

test('legitimate pending review and active evaluation preserve the consent path',async()=>{
 const p=harness(pending);
 assert.deepEqual(await review(p.service),{
   circle:CIRCLE,expiresAtMs:pending.expiresAtMs,proposalCreatedAtMs:created});
 assert.deepEqual(p.writes,[]);
 const a=harness(active);
 const result=await evaluate(a.service);
 assert.equal(result.evaluated,true);
 assert.equal(result.event,null);
 assert.equal(a.writes.length,1);
 assert.equal(a.writes[0][0],'setState');
 assert.equal(Object.hasOwn(a.writes[0][1],'latitude'),false);
 assert.equal(Object.hasOwn(a.writes[0][1],'point'),false);
});

test('invalid pending creation/expiry timeline cannot expose a review',async()=>{
 const broken=[
   {...pending,createdAtMs:undefined},
   {...pending,createdAtMs:'corrupt'},
   {...pending,createdAtMs:NOW+1},
   {...pending,createdAtMs:1.5},
   {...pending,expiresAtMs:created+PENDING_LIFETIME_MS+1}
 ];
 for(const zone of broken){
   const x=harness(zone);
   await assert.rejects(review(x.service),GeofenceDenied);
   assert.deepEqual(x.writes,[]);
 }
});

test('invalid active approval chronology cannot authorize GPS evaluation or mutate dedupe',async()=>{
 const broken=[
   {...active,createdAtMs:undefined},
   {...active,createdAtMs:NOW+1},
   {...active,approvedAtMs:undefined},
   {...active,approvedAtMs:'corrupt'},
   {...active,approvedAtMs:approved+0.5},
   {...active,approvedAtMs:created-1},
   {...active,approvedAtMs:NOW+1},
   {...active,createdAtMs:approved-PENDING_LIFETIME_MS},
   {...active,expiresAtMs:approved+MAX_ZONE_LIFETIME_MS+1}
 ];
 for(const zone of broken){
   const x=harness(zone);
   await assert.rejects(evaluate(x.service),GeofenceDenied);
   assert.deepEqual(x.writes,[]);
 }
});

test('authenticated subject can still revoke a corrupted active zone',async()=>{
 const x=harness({...active,approvedAtMs:'corrupt'});
 assert.deepEqual(await x.service.revoke({
   idToken:TOKEN,ownerUid:OWNER,subjectUid:SUBJECT
 }),{revoked:true});
 assert.deepEqual(x.writes.map(x=>x[0]),['deleteZone']);
});
