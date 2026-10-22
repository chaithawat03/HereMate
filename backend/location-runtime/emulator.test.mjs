/**
 * Real Firebase Admin Firestore transactions in an OFFLINE demo emulator.
 * The token verifier is deliberately synthetic; it does NOT validate Firebase
 * Auth SDK token signatures/revocation. That separate gate remains BLOCKED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {createLocationService,LocationDenied,LocationLimited,STAGING_PROJECT} from '../location/location-service.mjs';
import {createFirestoreLocationStore,createFirestoreLocationRateLimiter} from '../location/firestore-location-adapters.mjs';

const DEMO='demo-heremate-m053',HOST='127.0.0.1:8080';
const A='m2ownerrealadmin000001',B='m2viewerrealadmin00002',C='m2strangerrealadmin003';
const D='m2ownerrealadmin000004';
const bearer=uid=>'T'.repeat(64)+uid;
test('real Admin Firestore emulator transaction, consent revocation and durable rate limits', {timeout:90000},async t=>{
  // Refuse startup rather than ever touching a real Firebase project.
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
  assert.equal(process.env.GCLOUD_PROJECT,DEMO);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','');
  const app=initializeApp({projectId:DEMO},'heremate-m2-admin-emulator');
  const raw=getFirestore(app);
  t.after(async()=>{
    await raw.terminate();
    await deleteApp(app);
  });
  // Explicit test-only projection lets real demo Firestore transactions exercise
  // M2.1's staging-typed store contract without any real 'heremate' project I/O.
  // Live runtime uses getFirestore(actual staging app), never this projection.
  const db={
    projectId:STAGING_PROJECT,
    collection:name=>raw.collection(name),
    runTransaction:fn=>raw.runTransaction(fn)
  };
  const now=1800000000000;
  const stamp=(ms)=>Timestamp.fromMillis(ms);
  const relation=(owner,viewer)=>({
    schemaVersion:1,senderUid:owner,recipientUid:viewer,status:'accepted',
    senderConsent:true,recipientConsent:true,updatedAt:stamp(now)
  });
  const relRef=raw.collection('friendRequests').doc(A+'__'+B);
  const otherRel=raw.collection('friendRequests').doc(D+'__'+C);
  await relRef.set(relation(A,B));
  await otherRel.set(relation(D,C));
  const adminAuth={app:{options:{projectId:STAGING_PROJECT}},
    async verifyIdToken(token,checkRevoked) {
      assert.equal(checkRevoked,true);
      if(!token.startsWith('T'.repeat(64)))throw Error('invalid');
      const uid=token.slice(64);
      if(![A,B,C,D].includes(uid))throw Error('invalid');
      return {uid,sub:uid,aud:STAGING_PROJECT,
        iss:'https://securetoken.google.com/'+STAGING_PROJECT};
    }
  };
  const svc=createLocationService({
    adminAuth,
    store:createFirestoreLocationStore(db),
    rateLimiter:createFirestoreLocationRateLimiter(db,()=>now),
    clock:()=>now
  });
  const fix={latitude:13.75,longitude:100.5,accuracyMeters:12,capturedAtMs:now-1000};
  const start=()=>svc.start({idToken:bearer(A),viewerUid:B});
  const pub=()=>svc.publish({idToken:bearer(A),viewerUid:B,
    point:fix,appInForeground:true,foregroundPermissionGranted:true});
  const read=()=>svc.read({idToken:bearer(B),ownerUid:A});
  await assert.rejects(pub(),LocationDenied);
  await assert.rejects(read(),LocationDenied);
  const grant=await start();
  assert.equal(grant.enabled,true);
  await pub();
  assert.deepEqual((await read()).point,fix);
  const pointSnap=await raw.collection('private_latest_locations').doc(A+'__'+B).get();
  assert.equal(pointSnap.exists,true);
  assert.ok(pointSnap.data().expireAt instanceof Timestamp);
  await assert.rejects(svc.read({idToken:bearer(C),ownerUid:A}),LocationDenied);

  // Real Admin DB update: recipient's consent can revoke reads immediately.
  await relRef.update({recipientConsent:false,updatedAt:stamp(now+1)});
  await assert.rejects(read(),LocationDenied);
  await assert.rejects(pub(),LocationDenied);
  // Consent OFF -> ON does not revive a revision-bound earlier grant.
  await relRef.update({recipientConsent:true,updatedAt:stamp(now+2)});
  await assert.rejects(read(),LocationDenied);
  await assert.rejects(pub(),LocationDenied);
  await start();
  await pub();
  assert.deepEqual((await read()).point,fix);
  await svc.stop({idToken:bearer(A),viewerUid:B});
  assert.equal((await raw.collection('private_latest_locations').doc(A+'__'+B).get()).exists,false);
  assert.equal((await raw.collection('private_location_grants').doc(A+'__'+B).get()).exists,false);
  await assert.rejects(read(),LocationDenied);

  // Separate actor checks actual persisted Firestore rate-limit transactions.
  for(let i=0;i<6;i++) await svc.start({idToken:bearer(D),viewerUid:C});
  await assert.rejects(svc.start({idToken:bearer(D),viewerUid:C}),LocationLimited);
  const counters=await raw.collection('private_location_rate_limits').get();
  assert.ok(counters.size>0);
  assert.ok(counters.docs.every(d=>!d.id.includes(D)&&!d.id.includes(A)));
  assert.ok(counters.docs.every(d=>d.data().expireAt instanceof Timestamp));
});
