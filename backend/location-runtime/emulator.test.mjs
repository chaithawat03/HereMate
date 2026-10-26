/**
 * Real Firebase Admin Firestore transactions in an OFFLINE demo emulator.
 * The token verifier is deliberately synthetic; it does NOT validate Firebase
 * Auth SDK token signatures/revocation. That separate gate remains BLOCKED.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp,FieldValue} from 'firebase-admin/firestore';
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
  await svc.stop({idToken:bearer(A),viewerUid:B});
  await start();
  await pub();
  assert.deepEqual((await read()).point,fix);
  await svc.stop({idToken:bearer(A),viewerUid:B});
  assert.equal((await raw.collection('private_latest_locations').doc(A+'__'+B).get()).exists,false);
  assert.equal((await raw.collection('private_location_grants').doc(A+'__'+B).get()).exists,false);
  assert.equal((await raw.collection('private_location_publishers').doc(A).get()).exists,false);
  await assert.rejects(read(),LocationDenied);

  // Cross-recipient competing STARTs on the same owner-wide lease must not both commit.
  await raw.collection('friendRequests').doc(A+'__'+C).set(relation(A,C));
  const competing=await Promise.allSettled([
    svc.start({idToken:bearer(A),viewerUid:B}),
    svc.start({idToken:bearer(A),viewerUid:C})
  ]);
  assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(competing.filter(x=>x.status==='rejected').length,1);
  const leaseSnap=await raw.collection('private_location_publishers').doc(A).get();
  assert.equal(leaseSnap.exists,true);
  assert.ok([B,C].includes(leaseSnap.data().viewerUid));
  assert.ok(leaseSnap.data().expireAt instanceof Timestamp);
  await svc.stop({idToken:bearer(A),viewerUid:leaseSnap.data().viewerUid});
  assert.equal((await raw.collection('private_location_publishers').doc(A).get()).exists,false);

  // M3 device-bound session works on real Admin Firestore transactions,
  // and the raw capability must never be stored on private Firestore records.
  const device=await svc.startDevice({idToken:bearer(A),viewerUid:B});
  assert.match(device.sessionToken,/^[0-9a-f]{64}$/);
  const deviceGrant=await raw.collection('private_location_grants').doc(A+'__'+B).get();
  const devicePublisher=await raw.collection('private_location_publishers').doc(A).get();
  assert.equal(deviceGrant.data().sessionDigest,devicePublisher.data().sessionDigest);
  assert.notEqual(deviceGrant.data().sessionDigest,device.sessionToken);
  await assert.rejects(pub(),LocationDenied); // v1 device cannot publish into v2.
  const deviceFix={...fix,capturedAtMs:now};
  const send=token=>svc.publishDevice({idToken:bearer(A),viewerUid:B,
    sessionToken:token,point:deviceFix,
    appInForeground:true,foregroundPermissionGranted:true});
  // Real Firestore transaction: a fresh GPS fix from BEFORE M3 device START
  // is not authorized by this lease. Denial must not create a latest point.
  await assert.rejects(svc.publishDevice({idToken:bearer(A),viewerUid:B,
    sessionToken:device.sessionToken,point:fix,
    appInForeground:true,foregroundPermissionGranted:true}),LocationDenied);
  assert.equal((await raw.collection('private_latest_locations')
    .doc(A+'__'+B).get()).exists,false);
  await assert.rejects(send('0'.repeat(64)),LocationDenied);
  assert.deepEqual(await send(device.sessionToken),
    {stored:true,expiresAtMs:now+30000});
  assert.deepEqual((await read()).point,deviceFix);
  // Actual Admin Firestore readback: v2 latest-point provenance is bound to
  // the SAME hashed device lease as grant and owner-wide publisher. A
  // corrupted/orphan point cannot leak through a valid viewer read. Denial
  // must not update the point document or its TTL/updateTime.
  const v2LatestRef=raw.collection('private_latest_locations').doc(A+'__'+B);
  const v2GrantRef=raw.collection('private_location_grants').doc(A+'__'+B);
  const v2PublisherRef=raw.collection('private_location_publishers').doc(A);
  const validDigest=deviceGrant.data().sessionDigest;
  const pointV2=await v2LatestRef.get();
  assert.equal(pointV2.data().sessionDigest,validDigest);
  assert.equal(Object.hasOwn((await read()),'sessionDigest'),false,
    'the server never exposes private lease metadata to the viewer');
  await v2LatestRef.update({sessionDigest:FieldValue.delete()});
  const orphan=await v2LatestRef.get();
  await assert.rejects(read(),LocationDenied);
  const deniedOrphan=await v2LatestRef.get();
  assert.deepEqual(deniedOrphan.data(),orphan.data());
  assert.ok(deniedOrphan.updateTime.isEqual(orphan.updateTime));
  await v2LatestRef.update({sessionDigest:'a'.repeat(64)});
  await assert.rejects(read(),LocationDenied);
  await v2LatestRef.update({sessionDigest:validDigest});
  await v2GrantRef.update({sessionDigest:'b'.repeat(64)});
  await assert.rejects(read(),LocationDenied);
  await v2GrantRef.update({sessionDigest:validDigest});
  await v2PublisherRef.update({sessionDigest:'c'.repeat(64)});
  await assert.rejects(read(),LocationDenied);
  await v2PublisherRef.update({sessionDigest:validDigest});
  assert.deepEqual((await read()).point,deviceFix);
  // Real Admin Firestore: forged matching 4-minute grant/publisher expiry
  // cannot prolong a 60-second M3 v2 lease. Both READ and PUBLISH must deny
  // without touching the latest point or its Firestore updateTime.
  const validExpiry=deviceGrant.data().expiresAtMs;
  await v2GrantRef.update({expiresAtMs:now+4*60_000});
  await v2PublisherRef.update({expiresAtMs:now+4*60_000});
  const beforeExtended=await v2LatestRef.get();
  await assert.rejects(read(),LocationDenied);
  await assert.rejects(send(device.sessionToken),LocationDenied);
  const afterExtended=await v2LatestRef.get();
  assert.deepEqual(afterExtended.data(),beforeExtended.data());
  assert.ok(afterExtended.updateTime.isEqual(beforeExtended.updateTime));
  await v2GrantRef.update({expiresAtMs:validExpiry});
  await v2PublisherRef.update({expiresAtMs:validExpiry});
  assert.deepEqual((await read()).point,deviceFix);
  await assert.rejects(svc.stopDevice({idToken:bearer(A),viewerUid:B,
    sessionToken:'0'.repeat(64)}),LocationDenied);
  await svc.stopDevice({idToken:bearer(A),viewerUid:B,sessionToken:device.sessionToken});
  assert.equal((await raw.collection('private_latest_locations').doc(A+'__'+B).get()).exists,false);
  assert.equal((await raw.collection('private_location_publishers').doc(A).get()).exists,false);

  // Genuine Firestore optimistic concurrency: two distinct phone STARTs
  // for the same owner/viewer cannot both commit the single publisher lease.
  await raw.collection('friendRequests').doc(C+'__'+B).set(relation(C,B));
  const competingDevices=await Promise.allSettled([
    svc.startDevice({idToken:bearer(C),viewerUid:B}),
    svc.startDevice({idToken:bearer(C),viewerUid:B})
  ]);
  assert.equal(competingDevices.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(competingDevices.filter(x=>x.status==='rejected').length,1);
  const current=competingDevices.find(x=>x.status==='fulfilled').value;
  assert.match(current.sessionToken,/^[0-9a-f]{64}$/);
  await svc.stopDevice({idToken:bearer(C),viewerUid:B,
    sessionToken:current.sessionToken});

  // Separate actor checks actual persisted Firestore rate-limit transactions.
  for(let i=0;i<6;i++) {
    await svc.start({idToken:bearer(D),viewerUid:C});
    await svc.stop({idToken:bearer(D),viewerUid:C});
  }
  await assert.rejects(svc.start({idToken:bearer(D),viewerUid:C}),LocationLimited);
  const counters=await raw.collection('private_location_rate_limits').get();
  assert.ok(counters.size>0);
  assert.ok(counters.docs.every(d=>!d.id.includes(D)&&!d.id.includes(A)));
  assert.ok(counters.docs.every(d=>d.data().expireAt instanceof Timestamp));
});
