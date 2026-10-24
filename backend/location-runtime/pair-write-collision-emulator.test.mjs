/**
 * Real Firebase Admin Firestore emulator regression for ambiguous legacy pair
 * document IDs. Two distinct valid UID pairs can share owner+"__"+viewer.
 * This test never uses a live project, credentials, or actual device GPS.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {createLocationService,LocationDenied,STAGING_PROJECT,UID_PATTERN} from '../location/location-service.mjs';
import {createFirestoreLocationStore} from '../location/firestore-location-adapters.mjs';
import {createGeofenceService,GeofenceDenied} from '../geofences/geofence-service.mjs';
import {createFirestoreGeofenceStore} from '../geofences/firestore-geofence-store.mjs';

const DEMO='demo-heremate-m053',HOST='127.0.0.1:8080';
const foreignOwner='owner000000001__nested000000002';
const foreignViewer='viewer000000003';
const owner='owner000000001';
const viewer='nested000000002__viewer000000003';
const key=(a,b)=>a+'__'+b;
const now=1_800_000_000_000;
const bearer=uid=>'T'.repeat(64)+uid;
const circle={latitude:0,longitude:0,radiusMeters:350};
const fakeAuth={
  app:{options:{projectId:STAGING_PROJECT}},
  async verifyIdToken(value,revoked){
    assert.equal(revoked,true);
    const uid=value.startsWith('T'.repeat(64))?value.slice(64):'';
    if(uid!==owner&&uid!==viewer)throw Error('invalid test token');
    return {uid,sub:uid,aud:STAGING_PROJECT,
      iss:'https://securetoken.google.com/'+STAGING_PROJECT};
  }
};
const limiter={persistent:true,async consume(){return true;}};

test('real Firestore transactions reject foreign M2/M3 and M4 pair-key writes without mutation',
  {timeout:90000},async t=>{
    assert.equal(process.env.GCLOUD_PROJECT,DEMO);
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
    assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','');
    assert.equal(key(foreignOwner,foreignViewer),key(owner,viewer));
    for(const uid of [foreignOwner,foreignViewer,owner,viewer])
      assert.equal(UID_PATTERN.test(uid),true);

    const app=initializeApp({projectId:DEMO},'heremate-pair-collision-emulator');
    const db=getFirestore(app);
    t.after(async()=>{await db.terminate();await deleteApp(app);});
    const projection={
      projectId:STAGING_PROJECT,
      collection:name=>db.collection(name),
      runTransaction:fn=>db.runTransaction(fn)
    };
    const location=createLocationService({
      adminAuth:fakeAuth,store:createFirestoreLocationStore(projection),
      rateLimiter:limiter,clock:()=>now
    });
    const geofence=createGeofenceService({
      adminAuth:fakeAuth,store:createFirestoreGeofenceStore(projection),
      rateLimiter:limiter,clock:()=>now
    });
    const relation=db.collection('friendRequests').doc(key(owner,viewer));
    await relation.set({
      schemaVersion:1,senderUid:owner,recipientUid:viewer,
      status:'accepted',senderConsent:true,recipientConsent:true,
      updatedAt:Timestamp.fromMillis(now)
    });
    const grant=db.collection('private_location_grants').doc(key(owner,viewer));
    const point=db.collection('private_latest_locations').doc(key(owner,viewer));
    const zone=db.collection('private_geofence_zones').doc(key(owner,viewer));
    const state=db.collection('private_geofence_states').doc(key(owner,viewer));
    const start=()=>location.start({idToken:bearer(owner),viewerUid:viewer});
    const startDevice=()=>location.startDevice({idToken:bearer(owner),viewerUid:viewer});
    const propose=()=>geofence.propose({idToken:bearer(owner),subjectUid:viewer,circle});

    const foreignGrant={ownerUid:foreignOwner,viewerUid:foreignViewer,
      enabled:true,expiresAtMs:now-1000};
    await grant.set(foreignGrant);
    await assert.rejects(start(),LocationDenied);
    assert.deepEqual((await grant.get()).data(),foreignGrant);
    assert.equal((await db.collection('private_location_publishers').doc(owner).get()).exists,false);
    await grant.delete();

    const foreignPoint={ownerUid:foreignOwner,viewerUid:foreignViewer,
      point:{latitude:0,longitude:0,accuracyMeters:10,capturedAtMs:now-500},
      expiresAtMs:now-1000};
    await point.set(foreignPoint);
    await assert.rejects(startDevice(),LocationDenied);
    assert.deepEqual((await point.get()).data(),foreignPoint);
    assert.equal((await grant.get()).exists,false);
    await point.delete();

    const foreignZone={ownerUid:foreignOwner,subjectUid:foreignViewer,
      status:'pending',expiresAtMs:now-1000};
    await zone.set(foreignZone);
    await assert.rejects(propose(),GeofenceDenied);
    assert.deepEqual((await zone.get()).data(),foreignZone);
    assert.equal((await state.get()).exists,false);
    await zone.delete();

    const foreignState={ownerUid:foreignOwner,subjectUid:foreignViewer,
      zone:'outside',expiresAtMs:now-1000};
    await state.set(foreignState);
    await assert.rejects(propose(),GeofenceDenied);
    assert.deepEqual((await state.get()).data(),foreignState);
    assert.equal((await zone.get()).exists,false);
    await state.delete();

    // Positive controls: the guard must not deny legitimate same-pair writes.
    const started=await startDevice();
    assert.match(started.sessionToken,/^[0-9a-f]{64}$/);
    assert.equal((await grant.get()).data().ownerUid,owner);
    // Real Admin/Firestore M3 viewer READ: a corrupted publisher digest must
    // never expose an otherwise fresh GPS point, even if UID/expiry match.
    const publisherRef=db.collection('private_location_publishers').doc(owner);
    const originalPublisher=(await publisherRef.get()).data();
    const syntheticFix={latitude:0,longitude:0,accuracyMeters:10,capturedAtMs:now-500};
    await location.publishDevice({idToken:bearer(owner),viewerUid:viewer,
      sessionToken:started.sessionToken,point:syntheticFix,
      appInForeground:true,foregroundPermissionGranted:true});
    assert.deepEqual((await location.read({idToken:bearer(viewer),ownerUid:owner})).point,
      syntheticFix);
    await publisherRef.update({sessionDigest:'b'.repeat(64)});
    await assert.rejects(location.read({idToken:bearer(viewer),ownerUid:owner}),
      LocationDenied);
    assert.equal((await point.get()).exists,true,
      'denied READ must not mutate private point');
    await publisherRef.update({sessionDigest:originalPublisher.sessionDigest});
    assert.deepEqual((await location.read({idToken:bearer(viewer),ownerUid:owner})).point,
      syntheticFix);
    await location.stopDevice({idToken:bearer(owner),viewerUid:viewer,
      sessionToken:started.sessionToken});
    assert.equal((await grant.get()).exists,false);
    assert.equal((await point.get()).exists,false);
    const proposed=await propose();
    assert.equal(proposed.proposed,true);
    assert.equal((await zone.get()).data().ownerUid,owner);
    assert.deepEqual(await geofence.revoke({
      idToken:bearer(viewer),ownerUid:owner,subjectUid:viewer
    }),{revoked:true});
    assert.equal((await zone.get()).exists,false);
});
