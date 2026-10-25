/** M3 friend READ must never return a point from a split/corrupt publisher lease.
 * Offline synthetic Firestore transaction; no GPS devices, credentials or deploy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocationService,LocationDenied,STAGING_PROJECT} from '../backend/location/location-service.mjs';

const NOW=1_800_000_000_000;
const OWNER='m3leaseowner00000001',VIEWER='m3leaseviewer0000002';
const token=uid=>'T'.repeat(64)+uid;
const DIGEST_A='a'.repeat(64),DIGEST_B='b'.repeat(64);
const POINT={latitude:13.75,longitude:100.5,accuracyMeters:12,capturedAtMs:NOW-1000};
const relation={
  senderUid:OWNER,recipientUid:VIEWER,status:'accepted',
  senderConsent:true,recipientConsent:true,
  updatedAt:{seconds:1800000000,nanoseconds:0}
};
const grant={
  ownerUid:OWNER,viewerUid:VIEWER,enabled:true,
  relationRevision:'1800000000:0',expiresAtMs:NOW+50_000
};
const publisher={ownerUid:OWNER,viewerUid:VIEWER,expiresAtMs:NOW+50_000};
const point={ownerUid:OWNER,viewerUid:VIEWER,point:POINT,expiresAtMs:NOW+20_000};

function rig(leaseGrant,leasePublisher){
  const seen=[],writes=[];
  const service=createLocationService({
    adminAuth:{
      app:{options:{projectId:STAGING_PROJECT}},
      async verifyIdToken(idToken,checkRevoked){
        assert.equal(checkRevoked,true);
        const uid=idToken.startsWith('T'.repeat(64))?idToken.slice(64):null;
        if(uid!==OWNER&&uid!==VIEWER)throw Error('invalid_synthetic_token');
        return {uid,sub:uid,aud:STAGING_PROJECT,
          iss:'https://securetoken.google.com/'+STAGING_PROJECT};
      }
    },
    store:{
      projectId:STAGING_PROJECT,
      async transactPair(pair,work){
        seen.push(pair);
        // v2 points must carry the current grant's hashed device lease once
        // PR #117 is integrated; legacy M2 v1 points intentionally omit it.
        const storedPoint={...point,...(leaseGrant.sessionDigest!==undefined
          ?{sessionDigest:leaseGrant.sessionDigest}:{})};
        return work({
          relation,grant:leaseGrant,publisher:leasePublisher,point:storedPoint,
          setPoint:()=>writes.push('setPoint'),
          deletePoint:()=>writes.push('deletePoint')
        });
      }
    },
    rateLimiter:{persistent:true,async consume(){return true;}},
    clock:()=>NOW
  });
  return {service,seen,writes};
}
const read=service=>service.read({idToken:token(VIEWER),ownerUid:OWNER});

test('legacy M2 v1 matching grant/publisher without capability remains readable',async()=>{
  const x=rig({...grant},{...publisher});
  assert.deepEqual(await read(x.service),{point:POINT,expiresAtMs:point.expiresAtMs});
  assert.deepEqual(x.seen,[{ownerUid:OWNER,viewerUid:VIEWER}]);
  assert.deepEqual(x.writes,[]);
});

test('M3 v2 matching well-formed grant/publisher digest permits current authorized viewer',async()=>{
  const x=rig({...grant,sessionDigest:DIGEST_A},
    {...publisher,sessionDigest:DIGEST_A});
  assert.deepEqual(await read(x.service),{point:POINT,expiresAtMs:point.expiresAtMs});
  assert.deepEqual(x.writes,[]);
});

test('M3 viewer READ denies mismatched, missing and malformed publisher lease digests',async()=>{
  const cases=[
    [{...grant,sessionDigest:DIGEST_A},{...publisher,sessionDigest:DIGEST_B}],
    [{...grant,sessionDigest:DIGEST_A},{...publisher}],
    [{...grant},{...publisher,sessionDigest:DIGEST_A}],
    [{...grant,sessionDigest:null},{...publisher,sessionDigest:null}],
    [{...grant,sessionDigest:''},{...publisher,sessionDigest:''}],
    [{...grant,sessionDigest:'not-a-digest'},{...publisher,sessionDigest:'not-a-digest'}],
    [{...grant,sessionDigest:DIGEST_A.toUpperCase()},
      {...publisher,sessionDigest:DIGEST_A.toUpperCase()}],
    [{...grant,sessionDigest:DIGEST_A},{...publisher,sessionDigest:null}]
  ];
  for(const [g,p] of cases){
    const x=rig(g,p);
    await assert.rejects(read(x.service),LocationDenied);
    assert.deepEqual(x.writes,[],'invalid read must not mutate Firestore');
    assert.deepEqual(x.seen,[{ownerUid:OWNER,viewerUid:VIEWER}]);
  }
});

test('M3 matching session digest never bypasses expired grants or invalid publisher lease',async()=>{
  const cases=[
    [{...grant,sessionDigest:DIGEST_A,expiresAtMs:NOW-1},
      {...publisher,sessionDigest:DIGEST_A,expiresAtMs:NOW-1}],
    [{...grant,sessionDigest:DIGEST_A},
      {...publisher,sessionDigest:DIGEST_A,expiresAtMs:NOW+10_000}],
    [{...grant,sessionDigest:DIGEST_A},
      {...publisher,sessionDigest:DIGEST_A,viewerUid:'otheraccountuid0001'}]
  ];
  for(const [g,p] of cases){
    const x=rig(g,p);
    await assert.rejects(read(x.service),LocationDenied);
    assert.deepEqual(x.writes,[]);
  }
});
