/** M3 v2 STOP must never ACK remote revocation when the grant is missing
 * but the same pair's owner-wide publisher lease is still live.
 * Synthetic Firestore transaction; no credentials, GPS or deployment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocationService,LocationDenied,STAGING_PROJECT
} from '../backend/location/location-service.mjs';

const NOW=1_800_000_000_000;
const OWNER='ownerorphan000000001',VIEWER='viewerorphan00000002';
const OTHER='viewerother00000003';
const SESSION='a'.repeat(64);
const token=uid=>'T'.repeat(64)+uid;
function rig(initialPublisher,initialGrant=null){
  const row={publisher:initialPublisher,grant:initialGrant,point:null};
  const deleted=[];
  const store={projectId:STAGING_PROJECT,
    async transactPair({ownerUid,viewerUid},work){
      assert.equal(ownerUid,OWNER);
      assert.ok([VIEWER,OTHER].includes(viewerUid));
      const pending=[];
      const result=await work({
        relation:null,...row,
        deletePublisher:()=>pending.push('publisher'),
        deleteGrant:()=>pending.push('grant'),
        deletePoint:()=>pending.push('point')
      });
      for(const key of pending){deleted.push(key);row[key]=null;}
      return result;
    }
  };
  const adminAuth={app:{options:{projectId:STAGING_PROJECT}},
    async verifyIdToken(idToken,checkRevoked){
      assert.equal(checkRevoked,true);
      const uid=idToken.slice(64);
      assert.equal(idToken,token(uid));
      return {uid,sub:uid,aud:STAGING_PROJECT,
        iss:'https://securetoken.google.com/'+STAGING_PROJECT};
    }
  };
  return {row,deleted,service:createLocationService({
    adminAuth,store,rateLimiter:{persistent:true,consume:async()=>true},
    clock:()=>NOW
  })};
}
const publisher=(viewerUid=VIEWER,expiresAtMs=NOW+30_000)=>({
  ownerUid:OWNER,viewerUid,expiresAtMs,sessionDigest:'b'.repeat(64)
});
const stopV2=(service,viewerUid=VIEWER)=>service.stopDevice({
  idToken:token(OWNER),viewerUid,sessionToken:SESSION
});

test('missing grant + live same-pair publisher denies false v2 STOP ACK',async()=>{
  const live=publisher();
  const x=rig(live);
  await assert.rejects(stopV2(x.service),LocationDenied);
  assert.strictEqual(x.row.publisher,live);
  assert.deepEqual(x.deleted,[]);
  // The authenticated owner-wide emergency STOP remains usable without a
  // grant or device token; it is the safe way to release this orphan lease.
  assert.deepEqual(await x.service.stop({
    idToken:token(OWNER),viewerUid:VIEWER
  }),{enabled:false});
  assert.deepEqual(x.deleted,['publisher']);
  assert.deepEqual(await stopV2(x.service),{enabled:false});
});

test('missing grant with a DIFFERENT active viewer lease is idempotent',async()=>{
  const other=publisher(OTHER);
  const x=rig(other);
  assert.deepEqual(await stopV2(x.service),{enabled:false});
  assert.strictEqual(x.row.publisher,other);
  assert.deepEqual(x.deleted,[]);
});

test('expired same-pair publisher without a grant cannot keep sharing active',async()=>{
  const expired=publisher(VIEWER,NOW-1);
  const x=rig(expired);
  assert.deepEqual(await stopV2(x.service),{enabled:false});
  assert.strictEqual(x.row.publisher,expired);
  assert.deepEqual(x.deleted,[]);
});

test('missing grant with invalid same-pair publisher expiry fails closed',async()=>{
  for(const expiresAtMs of [undefined,NaN,Infinity,'later']){
    const x=rig(publisher(VIEWER,expiresAtMs));
    await assert.rejects(stopV2(x.service),LocationDenied);
    assert.deepEqual(x.deleted,[]);
  }
});

test('missing grant and no publisher retains v2 STOP idempotency',async()=>{
  const x=rig(null);
  assert.deepEqual(await stopV2(x.service),{enabled:false});
  assert.deepEqual(x.deleted,[]);
});
