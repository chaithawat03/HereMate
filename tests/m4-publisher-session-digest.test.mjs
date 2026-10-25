/** Offline M4/M3 publisher-lease integrity regression.
 * Synthetic 0,0 fixes; no Android hardware, cloud credentials, or GPS history.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeofenceService,GeofenceDenied} from '../backend/geofences/geofence-service.mjs';
import {STAGING_PROJECT} from '../backend/location/location-service.mjs';

const NOW=1_800_000_000_000;
const OWNER='zoneowner000000001',SUBJECT='subject0000000001';
const RELATION_REVISION='1800000000:0';
const DIGEST_A='a'.repeat(64),DIGEST_B='b'.repeat(64);
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

function rig(grant,publisher){
  const writes=[];
  const store={
    projectId:STAGING_PROJECT,
    async transactZone({ownerUid,subjectUid},work){
      assert.equal(ownerUid,OWNER);
      assert.equal(subjectUid,SUBJECT);
      const pending=[];
      const result=await work({
        relation,zone,state:null,grant,publisher,
        setState:row=>pending.push(row),
        deleteState:()=>pending.push(null)
      });
      writes.push(...pending);
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
    writes,
    service:createGeofenceService({adminAuth,store,
      rateLimiter:{persistent:true,consume:async()=>true},clock:()=>NOW})
  };
}
const evaluate=service=>service.evaluate({
  idToken:token(SUBJECT),ownerUid:OWNER,point:FIX,
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
  assert.equal((await evaluate(x.service)).evaluated,true);
  assert.equal(x.writes.length,1);
  assert.equal(Object.hasOwn(x.writes[0],'point'),false);
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
