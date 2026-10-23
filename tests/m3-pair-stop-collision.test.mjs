import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createLocationService,LocationDenied,STAGING_PROJECT,UID_PATTERN
} from '../backend/location/location-service.mjs';

// The legacy key ownerUid + "__" + viewerUid is ambiguous for valid UIDs.
const OWNER='owner000000001__nested000000002';
const VIEWER='viewer000000003';
const OTHER_OWNER='owner000000001';
const OTHER_VIEWER='nested000000002__viewer000000003';
const key=(owner,viewer)=>owner+'__'+viewer;
const token=uid=>'T'.repeat(64)+uid;
const SESSION='a'.repeat(64);
const DIGEST=createHash('sha256').update('m3-device-session:v1:'+SESSION).digest('hex');

function rig(grant,point,publisher=null){
  const records=new Map([[key(OWNER,VIEWER),{grant,point,publisher}]]);
  const deleted=[];
  const store={
    projectId:STAGING_PROJECT,
    async transactPair({ownerUid,viewerUid},work){
      const doc=key(ownerUid,viewerUid);
      const row=records.get(doc)??{grant:null,point:null,publisher:null};
      const operations=[];
      const result=await work({
        relation:null,grant:row.grant,point:row.point,publisher:row.publisher,
        deleteGrant:()=>operations.push('grant'),
        deletePoint:()=>operations.push('point'),
        deletePublisher:()=>operations.push('publisher')
      });
      for(const operation of operations){
        row[operation]=null;
        deleted.push(operation);
      }
      records.set(doc,row);
      return result;
    }
  };
  const adminAuth={
    app:{options:{projectId:STAGING_PROJECT}},
    async verifyIdToken(idToken,revoked){
      assert.equal(revoked,true);
      if(!idToken.startsWith('T'.repeat(64)))throw Error('invalid token');
      const uid=idToken.slice(64);
      return {uid,sub:uid,aud:STAGING_PROJECT,
        iss:'https://securetoken.google.com/'+STAGING_PROJECT};
    }
  };
  return {service:createLocationService({
    adminAuth,store,rateLimiter:{persistent:true,consume:async()=>true},
    clock:()=>1_800_000_000_000
  }),records,deleted,documentId:key(OWNER,VIEWER)};
}
test('two distinct accepted UID shapes can address the same legacy pair key',()=>{
  assert.notEqual(OWNER,OTHER_OWNER);
  assert.notEqual(VIEWER,OTHER_VIEWER);
  assert.equal(key(OWNER,VIEWER),key(OTHER_OWNER,OTHER_VIEWER));
  for(const uid of [OWNER,VIEWER,OTHER_OWNER,OTHER_VIEWER])
    assert.equal(UID_PATTERN.test(uid),true);
});
test('M2 STOP cannot delete another pair grant/point at a colliding key',async()=>{
  const grant={ownerUid:OWNER,viewerUid:VIEWER,enabled:true};
  const point={ownerUid:OWNER,viewerUid:VIEWER,point:{latitude:0,longitude:0}};
  const x=rig(grant,point);
  await assert.rejects(x.service.stop({
    idToken:token(OTHER_OWNER),viewerUid:OTHER_VIEWER
  }),LocationDenied);
  assert.deepEqual(x.deleted,[]);
  assert.deepEqual(x.records.get(x.documentId),{grant,point,publisher:null});
  // Legitimate owner retains STOP after unfriend: no relation was provided.
  assert.deepEqual(await x.service.stop({
    idToken:token(OWNER),viewerUid:VIEWER
  }),{enabled:false});
  assert.deepEqual(x.deleted,['grant','point']);
  assert.deepEqual(await x.service.stop({
    idToken:token(OWNER),viewerUid:VIEWER
  }),{enabled:false});
  assert.deepEqual(x.deleted,['grant','point']);
});
test('M2 STOP cannot erase orphan foreign GPS point when grant is absent',async()=>{
  const point={ownerUid:OWNER,viewerUid:VIEWER,point:{latitude:0,longitude:0}};
  const x=rig(null,point);
  await assert.rejects(x.service.stop({
    idToken:token(OTHER_OWNER),viewerUid:OTHER_VIEWER
  }),LocationDenied);
  assert.strictEqual(x.records.get(x.documentId).point,point);
  assert.deepEqual(x.deleted,[]);
});
test('M3 v2 STOP cannot erase a foreign point even with matching own capability',async()=>{
  const grant={ownerUid:OTHER_OWNER,viewerUid:OTHER_VIEWER,sessionDigest:DIGEST};
  const point={ownerUid:OWNER,viewerUid:VIEWER,point:{latitude:0,longitude:0}};
  const publisher={ownerUid:OTHER_OWNER,viewerUid:OTHER_VIEWER,sessionDigest:DIGEST};
  const x=rig(grant,point,publisher);
  await assert.rejects(x.service.stopDevice({
    idToken:token(OTHER_OWNER),viewerUid:OTHER_VIEWER,sessionToken:SESSION
  }),LocationDenied);
  assert.deepEqual(x.deleted,[]);
  assert.deepEqual(x.records.get(x.documentId),{grant,point,publisher});
});
test('M3 v2 valid capability STOP still deletes own records and is idempotent',async()=>{
  const grant={ownerUid:OWNER,viewerUid:VIEWER,sessionDigest:DIGEST};
  const point={ownerUid:OWNER,viewerUid:VIEWER,point:{latitude:0,longitude:0}};
  const publisher={ownerUid:OWNER,viewerUid:VIEWER,sessionDigest:DIGEST};
  const x=rig(grant,point,publisher);
  assert.deepEqual(await x.service.stopDevice({
    idToken:token(OWNER),viewerUid:VIEWER,sessionToken:SESSION
  }),{enabled:false});
  assert.deepEqual(x.deleted,['grant','point','publisher']);
  assert.deepEqual(await x.service.stopDevice({
    idToken:token(OWNER),viewerUid:VIEWER,sessionToken:SESSION
  }),{enabled:false});
  assert.deepEqual(x.deleted,['grant','point','publisher']);
});
