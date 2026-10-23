import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeofenceService,GeofenceDenied
} from '../backend/geofences/geofence-service.mjs';
import {STAGING_PROJECT} from '../backend/location/location-service.mjs';

// UID_PATTERN permits underscores. The legacy Firestore key "owner__subject"
// is not injective: these two distinct, valid UID pairs have the same key.
const OWNER='owner000000001__nested000000002';
const SUBJECT='subject000000003';
const COLLIDING_OWNER='owner000000001';
const COLLIDING_SUBJECT='nested000000002__subject000000003';
const pair=(owner,subject)=>owner+'__'+subject;
const token=uid=>'T'.repeat(64)+uid;

function rig(zone,state){
  const key=pair(OWNER,SUBJECT);
  const rows=new Map([[key,{zone,state}]]);
  const deletes=[];
  const store={
    projectId:STAGING_PROJECT,
    async transactZone({ownerUid,subjectUid},work){
      const documentId=pair(ownerUid,subjectUid);
      const row=rows.get(documentId)??{zone:null,state:null};
      const operations=[];
      const result=await work({
        zone:row.zone,state:row.state,
        deleteZone:()=>operations.push('zone'),
        deleteState:()=>operations.push('state')
      });
      for(const operation of operations){
        row[operation]=null;
        deletes.push(operation);
      }
      rows.set(documentId,row);
      return result;
    }
  };
  const adminAuth={
    app:{options:{projectId:STAGING_PROJECT}},
    async verifyIdToken(idToken,checkRevoked){
      assert.equal(checkRevoked,true);
      if(!idToken.startsWith('T'.repeat(64)))throw Error('invalid token');
      const uid=idToken.slice(64);
      return {uid,sub:uid,aud:STAGING_PROJECT,
        iss:'https://securetoken.google.com/'+STAGING_PROJECT};
    }
  };
  const service=createGeofenceService({
    adminAuth,store,
    rateLimiter:{persistent:true,consume:async()=>true},
    clock:()=>1_800_000_000_000
  });
  return {service,rows,deletes,key};
}
test('distinct valid UID pairs collide under legacy Firestore pair encoding',()=>{
  assert.notEqual(OWNER,COLLIDING_OWNER);
  assert.notEqual(SUBJECT,COLLIDING_SUBJECT);
  assert.equal(pair(OWNER,SUBJECT),pair(COLLIDING_OWNER,COLLIDING_SUBJECT));
  for(const uid of [OWNER,SUBJECT,COLLIDING_OWNER,COLLIDING_SUBJECT])
    assert.match(uid,/^[A-Za-z0-9_-]{12,128}$/);
});
test('authenticated colliding pair cannot revoke another pair zone or state',async()=>{
  const zone={ownerUid:OWNER,subjectUid:SUBJECT,status:'active'};
  const state={ownerUid:OWNER,subjectUid:SUBJECT,zone:'inside'};
  const x=rig(zone,state);
  await assert.rejects(x.service.revoke({
    idToken:token(COLLIDING_OWNER),
    ownerUid:COLLIDING_OWNER,subjectUid:COLLIDING_SUBJECT
  }),GeofenceDenied);
  assert.deepEqual(x.rows.get(x.key),{zone,state});
  assert.deepEqual(x.deletes,[]);
  // The legitimate tracked subject retains revocation even after unfriend.
  assert.deepEqual(await x.service.revoke({
    idToken:token(SUBJECT),ownerUid:OWNER,subjectUid:SUBJECT
  }),{revoked:true});
  assert.deepEqual(x.deletes,['zone','state']);
  assert.deepEqual(await x.service.revoke({
    idToken:token(OWNER),ownerUid:OWNER,subjectUid:SUBJECT
  }),{revoked:true});
  assert.deepEqual(x.deletes,['zone','state'],'repeat is idempotent');
});
test('orphaned foreign state alone cannot be deleted by a colliding pair',async()=>{
  const state={ownerUid:OWNER,subjectUid:SUBJECT,zone:'outside'};
  const x=rig(null,state);
  await assert.rejects(x.service.revoke({
    idToken:token(COLLIDING_SUBJECT),
    ownerUid:COLLIDING_OWNER,subjectUid:COLLIDING_SUBJECT
  }),GeofenceDenied);
  assert.strictEqual(x.rows.get(x.key).state,state);
  assert.deepEqual(x.deletes,[]);
  await assert.rejects(x.service.revoke({
    idToken:token('stranger0000000001'),ownerUid:OWNER,subjectUid:SUBJECT
  }),GeofenceDenied);
  assert.deepEqual(x.deletes,[]);
});
test('missing owner or subject in legacy records fails closed rather than deleting',async()=>{
  const x=rig({status:'active'},null);
  await assert.rejects(x.service.revoke({
    idToken:token(OWNER),ownerUid:OWNER,subjectUid:SUBJECT
  }),GeofenceDenied);
  assert.deepEqual(x.deletes,[]);
});
