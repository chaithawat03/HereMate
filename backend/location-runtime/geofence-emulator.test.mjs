/**
 * M4 Firestore Admin transactional E2E against isolated DEMO emulator only.
 * No production credentials, no network-bound M4 route, no mobile GPS.
 */
import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {
 createGeofenceService,GeofenceDenied,GeofenceInvalid,GeofenceLimited
} from '../geofences/geofence-service.mjs';
import {createFirestoreGeofenceStore} from '../geofences/firestore-geofence-store.mjs';
import {createFirestoreGeofenceRateLimiter,GEOFENCE_ROUTE_LIMITS} from '../geofences/geofence-rate-limiter.mjs';
import {createLocationService,STAGING_PROJECT} from '../location/location-service.mjs';
import {createFirestoreLocationStore,createFirestoreLocationRateLimiter} from '../location/firestore-location-adapters.mjs';
import {advanceState,EMPTY_STATE,distanceMeters} from '../geofences/geofence-policy.mjs';

const DEMO='demo-heremate-m053',HOST='127.0.0.1:8080';
const A='zoneowneruid000001',B='zonesubjectuid0002',C='zonestrangeruid0003';
const bearer=who=>'T'.repeat(64)+who;
test('policy suppresses uncertain boundaries and first sightings without saving a path',()=>{
 const circle={latitude:0,longitude:179.99,radiusMeters:350};
 const at=1_800_000_000_000;
 assert.ok(distanceMeters(circle,{latitude:0,longitude:-179.99})<2300);
 const fix=(lat,accuracy=10,time=at)=>({
   latitude:lat,longitude:179.99,accuracyMeters:accuracy,capturedAtMs:time-100
 });
 assert.equal(advanceState(circle,fix(0),at).next.pending,'inside');
 assert.equal(advanceState(circle,fix(0.0031,75),at).quality,'ambiguous');
 assert.equal(advanceState(circle,fix(0,300),at).quality,'invalid');
 assert.equal(advanceState(circle,fix(0,10,at-60_000),at).quality,'invalid');
 assert.equal(advanceState(circle,fix(91),at).quality,'invalid');
 assert.equal(advanceState(circle,fix(0),at,EMPTY_STATE).event,null);
});
test('M4 replay and out-of-order captures cannot fabricate Enter/Exit',()=>{
 const now=1_800_000_000_000;
 const circle={latitude:0,longitude:0,radiusMeters:350};
 const at=(latitude,capturedAtMs)=>({latitude,longitude:0,
   accuracyMeters:12,capturedAtMs});
 const base=advanceState(circle,at(0.02,now-200),now).next;
 assert.equal(base.pending,'outside');
 const same=advanceState(circle,at(0.02,now-200),now,base);
 assert.equal(same.quality,'ambiguous');
 assert.equal(same.next.streak,1);
 assert.equal(same.next.zone,'unknown');
 const established=advanceState(circle,at(0.02,now+800),now+1000,same.next);
 assert.equal(established.next.zone,'outside');
 const proposed=advanceState(circle,at(0,now+1800),now+2000,established.next);
 assert.equal(proposed.next.streak,1);
 const replay=advanceState(circle,at(0,now+1800),now+2000,proposed.next);
 assert.equal(replay.event,null);
 assert.equal(replay.next.zone,'outside');
 const old=advanceState(circle,at(0,now+800),now+2000,replay.next);
 assert.equal(old.event,null);
 const changed=advanceState(circle,at(0,now+2800),now+3000,old.next);
 assert.equal(changed.event,'enter');
 const late=advanceState(circle,at(0.02,now+35_000),now+35_200,changed.next);
 assert.equal(late.next.streak,1);
 assert.equal(late.next.zone,'unknown'); // stale baseline cannot emit a fake Exit
 const longGap=advanceState(circle,at(0.02,now+75_000),now+75_200,late.next);
 assert.equal(longGap.event,null);
 assert.equal(longGap.next.streak,1);
 const oldSchema=advanceState(circle,at(0.02,now+1800),now+2000,
   {zone:'inside',pending:'outside',streak:1,lastEventAtMs:null});
 assert.equal(oldSchema.next.zone,'unknown');
 assert.equal(oldSchema.event,null);
 for(const s of [base,same.next,established.next,proposed.next,replay.next,changed.next]){
   assert.equal(Object.hasOwn(s,'latitude'),false);
   assert.equal(Object.hasOwn(s,'longitude'),false);
   assert.equal(Object.hasOwn(s,'point'),false);
 }
});
test('real isolated transactions: informed subject opt-in, active M2 lease, enter/exit and revoke',
 {timeout:90000},async t=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
 assert.equal(process.env.GCLOUD_PROJECT,DEMO);
 assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','');
 const app=initializeApp({projectId:DEMO},'m4-geofence-test-isolated');
 const db=getFirestore(app);
 t.after(async()=>{await db.terminate();await deleteApp(app);});
 const projection={
   projectId:STAGING_PROJECT,
   collection:name=>db.collection(name),
   runTransaction:fn=>db.runTransaction(fn)
 };
 let now=1_800_000_000_000;
 const auth={app:{options:{projectId:STAGING_PROJECT}},
   async verifyIdToken(token,revoked){
     assert.equal(revoked,true);
     const who=token.startsWith('T'.repeat(64))?token.slice(64):'';
     if(![A,B,C].includes(who))throw Error('invalid token');
     return {uid:who,sub:who,aud:STAGING_PROJECT,
       iss:'https://securetoken.google.com/'+STAGING_PROJECT};
   }
 };
 const geofence=createGeofenceService({
   adminAuth:auth,store:createFirestoreGeofenceStore(projection),
   rateLimiter:createFirestoreGeofenceRateLimiter(projection,()=>now),
   clock:()=>now
 });
 const location=createLocationService({
   adminAuth:auth,store:createFirestoreLocationStore(projection),
   rateLimiter:createFirestoreLocationRateLimiter(projection,()=>now),
   clock:()=>now
 });
 const zoneRef=db.collection('private_geofence_zones').doc(A+'__'+B);
 const stateRef=db.collection('private_geofence_states').doc(A+'__'+B);
 const rel=db.collection('friendRequests').doc(A+'__'+B);
 const circle={latitude:0,longitude:0,radiusMeters:350};
 const args={idToken:bearer(A),subjectUid:B,circle};
 const fix=(lat=0)=>({latitude:lat,longitude:0,accuracyMeters:12,capturedAtMs:now-200});
 const sample=()=>geofence.evaluate({
   idToken:bearer(B),ownerUid:A,point:fix(),
   appInForeground:true,foregroundPermissionGranted:true
 });
 await assert.rejects(geofence.propose(args),GeofenceDenied);
 await rel.set({
   senderUid:A,recipientUid:B,status:'accepted',
   senderConsent:true,recipientConsent:false,
   updatedAt:Timestamp.fromMillis(now)
 });
 await assert.rejects(geofence.propose(args),GeofenceDenied);
 await rel.update({recipientConsent:true,updatedAt:Timestamp.fromMillis(now+1)});
 await assert.rejects(geofence.propose({...args,circle:{...circle,radiusMeters:5}}),
   GeofenceInvalid);
 const proposal=await geofence.propose(args);
 assert.equal(proposal.proposed,true);
 assert.ok(proposal.expiresAtMs>now);
 await assert.rejects(geofence.review({idToken:bearer(C),ownerUid:A}),GeofenceDenied);
 await assert.rejects(sample(),GeofenceDenied);
 const firstReview=await geofence.review({idToken:bearer(B),ownerUid:A});
 assert.deepEqual(firstReview.circle,circle);
 assert.equal(firstReview.proposalCreatedAtMs,now);
 await assert.rejects(geofence.propose(args),GeofenceDenied);
 assert.deepEqual(await geofence.decide({idToken:bearer(B),ownerUid:A,
   approve:false,proposalCreatedAtMs:firstReview.proposalCreatedAtMs}),
   {approved:false});
 assert.equal((await zoneRef.get()).exists,false);
 // Four proposals in one minute (including denied attempts) exhaust
 // the persistent per-actor quota; advancing the injected test clock
 // exercises a legitimate next-window retry without touching live GCP.
 await assert.rejects(geofence.propose(args),GeofenceLimited);
 now+=60_001;
 const replacementCircle={...circle,radiusMeters:500};
 await geofence.propose({...args,circle:replacementCircle});
 // An earlier reviewed proposal must NOT authorize a different replacement
 // after expiry/reproposal. Rejected stale decisions leave it pending.
 await assert.rejects(geofence.decide({idToken:bearer(B),ownerUid:A,
   approve:true,proposalCreatedAtMs:firstReview.proposalCreatedAtMs}),GeofenceDenied);
 await assert.rejects(geofence.decide({idToken:bearer(B),ownerUid:A,
   approve:false,proposalCreatedAtMs:firstReview.proposalCreatedAtMs}),GeofenceDenied);
 assert.equal((await zoneRef.get()).data().status,'pending');
 const secondReview=await geofence.review({idToken:bearer(B),ownerUid:A});
 assert.deepEqual(secondReview.circle,replacementCircle);
 assert.notEqual(secondReview.proposalCreatedAtMs,firstReview.proposalCreatedAtMs);
 await assert.rejects(geofence.decide({idToken:bearer(B),ownerUid:A,
   approve:true,proposalCreatedAtMs:1.5}),GeofenceInvalid);
 const accepted=await geofence.decide({idToken:bearer(B),ownerUid:A,
   approve:true,proposalCreatedAtMs:secondReview.proposalCreatedAtMs});
 assert.equal(accepted.approved,true);
 assert.ok(accepted.expiresAtMs>now);
 await assert.rejects(geofence.decide({idToken:bearer(B),ownerUid:A,
   approve:true,proposalCreatedAtMs:secondReview.proposalCreatedAtMs}),GeofenceDenied);
 await assert.rejects(sample(),GeofenceDenied,'requires M2 publisher/grant');
 await location.start({idToken:bearer(B),viewerUid:A});
 const out=()=>geofence.evaluate({
   idToken:bearer(B),ownerUid:A,point:fix(0.02),
   appInForeground:true,foregroundPermissionGranted:true
 });
 let p=await out();assert.equal(p.event,null);
 // A replay of the same source GPS fix cannot establish a baseline.
 p=await out();assert.equal(p.event,null);
 assert.equal((await stateRef.get()).data().streak,1);
 now+=1000;
 p=await out();assert.equal(p.event,null); // distinct fix establishes outside
 now+=1000;
 p=await sample();assert.equal(p.event,null);
 p=await sample();assert.equal(p.event,null); // replay must not emit Enter
 now+=1000;
 p=await sample();assert.equal(p.event,'enter');
 let state=(await stateRef.get()).data();
 assert.ok(state.expireAt instanceof Timestamp);
 for(const forbidden of ['latitude','longitude','circle','point','fix','route','history'])
   assert.equal(Object.hasOwn(state,forbidden),false);
 assert.equal(state.lastEventAtMs,now);
 now+=1000;
 p=await out();assert.equal(p.event,null);
 now+=1000;
 p=await out();assert.equal(p.event,null); // cooldown suppresses transition
 // Consent changes invalidate both zone and M2 grant on the very next request.
 await rel.update({recipientConsent:false,updatedAt:Timestamp.fromMillis(now+2)});
 await assert.rejects(sample(),GeofenceDenied);
 await rel.update({recipientConsent:true,updatedAt:Timestamp.fromMillis(now+3)});
 await assert.rejects(sample(),GeofenceDenied,'old approvals never revive on re-consent');
 // Any participant can revoke even after removal; no client GPS history.
 await rel.update({status:'removed',senderConsent:false,recipientConsent:false,
   updatedAt:Timestamp.fromMillis(now+4)});
 assert.deepEqual(await geofence.revoke({idToken:bearer(B),ownerUid:A,subjectUid:B}),
   {revoked:true});
 assert.equal((await zoneRef.get()).exists,false);
 assert.equal((await stateRef.get()).exists,false);
 assert.deepEqual(await geofence.revoke({idToken:bearer(B),ownerUid:A,subjectUid:B}),
   {revoked:true}); // always revocable, even after prior successful revoke
 await assert.rejects(sample(),GeofenceDenied);
 await assert.rejects(geofence.revoke({
   idToken:bearer(C),ownerUid:A,subjectUid:B
 }),GeofenceDenied);
 // A stranger exhausting real persistent limiter cannot brute force review.
 // The earlier review was in the previous 60-second window.
 for(let i=0;i<GEOFENCE_ROUTE_LIMITS.review;i++)
   await assert.rejects(geofence.review({idToken:bearer(C),ownerUid:A}),GeofenceDenied);
 await assert.rejects(geofence.review({idToken:bearer(C),ownerUid:A}),GeofenceLimited);
 const limits=await db.collection('private_geofence_rate_limits').get();
 assert.ok(limits.size>=3);
 assert.ok(limits.docs.every(d=>/^[0-9a-f]{64}$/.test(d.id)));
 assert.ok(limits.docs.every(d=>!d.id.includes(A)&&!d.id.includes(B)&&
   d.data().expireAt instanceof Timestamp));
 // Separate real Firestore docs remain server-only and expire by finite TTL.
 assert.ok((await db.collection('private_location_grants').doc(B+'__'+A).get()).exists);
});

test('real Firestore: M4 publisher lease handoff resets old-device transition state, not GPS history',
 {timeout:90000},async t=>{
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
  assert.equal(process.env.GCLOUD_PROJECT,DEMO);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','');
  const app=initializeApp({projectId:DEMO},'m4-device-lease-handoff-isolated');
  const db=getFirestore(app);
  t.after(async()=>{await db.terminate();await deleteApp(app);});
  const projection={projectId:STAGING_PROJECT,
    collection:name=>db.collection(name),runTransaction:fn=>db.runTransaction(fn)};
  const owner='leasezoneowner000004',subject='leasesubject000005';
  const now=1_800_000_000_000;
  const relationUpdated=Timestamp.fromMillis(now-10_000);
  const revision=relationUpdated.seconds+':'+relationUpdated.nanoseconds;
  const tokenA='a'.repeat(64),tokenB='b'.repeat(64);
  const digest=token=>createHash('sha256')
    .update('m3-device-session:v1:'+token).digest('hex');
  const pair=owner+'__'+subject,grantPair=subject+'__'+owner;
  const zoneRef=db.collection('private_geofence_zones').doc(pair);
  const stateRef=db.collection('private_geofence_states').doc(pair);
  await Promise.all([
    db.collection('friendRequests').doc(pair).set({
      senderUid:owner,recipientUid:subject,status:'accepted',
      senderConsent:true,recipientConsent:true,updatedAt:relationUpdated
    }),
    zoneRef.set({ownerUid:owner,subjectUid:subject,status:'active',
      relationRevision:revision,createdAtMs:now-6000,approvedAtMs:now-5000,
      expiresAtMs:now+3600_000,
      circle:{latitude:0,longitude:0,radiusMeters:350}
    }),
    db.collection('private_location_grants').doc(grantPair).set({
      ownerUid:subject,viewerUid:owner,enabled:true,
      relationRevision:revision,expiresAtMs:now+50_000,
      sessionDigest:digest(tokenB)
    }),
    db.collection('private_location_publishers').doc(subject).set({
      ownerUid:subject,viewerUid:owner,expiresAtMs:now+50_000,
      sessionDigest:digest(tokenB)
    }),
    stateRef.set({ownerUid:owner,subjectUid:subject,
      relationRevision:revision,approvedAtMs:now-5000,
      expiresAtMs:now+3600_000,zone:'inside',pending:null,streak:0,
      lastEventAtMs:now-1000,lastSampleCapturedAtMs:now-4000,
      sessionDigest:digest(tokenA)
    })
  ]);
  const auth={app:{options:{projectId:STAGING_PROJECT}},
    async verifyIdToken(value,revoked){
      assert.equal(value,bearer(subject));
      assert.equal(revoked,true);
      return {uid:subject,sub:subject,aud:STAGING_PROJECT,
        iss:'https://securetoken.google.com/'+STAGING_PROJECT};
    }
  };
  const service=createGeofenceService({adminAuth:auth,
    store:createFirestoreGeofenceStore(projection),
    rateLimiter:{persistent:true,consume:async()=>true},clock:()=>now});
  const evalAt=(sessionToken,capturedAtMs)=>service.evaluate({
    idToken:bearer(subject),ownerUid:owner,sessionToken,
    point:{latitude:0.01,longitude:0,accuracyMeters:10,capturedAtMs},
    appInForeground:true,foregroundPermissionGranted:true
  });
  const before=await stateRef.get();
  await assert.rejects(evalAt(tokenA,now-2000),GeofenceDenied);
  assert.equal((await stateRef.get()).updateTime.toMillis(),
    before.updateTime.toMillis(),'retired device token cannot mutate state');
  assert.equal((await evalAt(tokenB,now-2000)).event,null);
  let stored=(await stateRef.get()).data();
  assert.equal(stored.zone,'unknown');
  assert.equal(stored.pending,'outside');
  assert.equal(stored.sessionDigest,digest(tokenB));
  assert.equal((await evalAt(tokenB,now-500)).event,null);
  stored=(await stateRef.get()).data();
  assert.equal(stored.zone,'outside');
  assert.equal(stored.sessionDigest,digest(tokenB));
  assert.equal(stored.lastEventAtMs,now-1000,
    'new publisher cannot reset an approved zone notification cooldown');
  // New handset B has established its own outside baseline. Two inside
  // fixes within handset A's 5-minute cooldown must not duplicate Enter.
  assert.equal((await service.evaluate({
    idToken:bearer(subject),ownerUid:owner,sessionToken:tokenB,
    point:{latitude:0,longitude:0,accuracyMeters:10,capturedAtMs:now+700},
    appInForeground:true,foregroundPermissionGranted:true
  })).event,null);
  assert.equal((await service.evaluate({
    idToken:bearer(subject),ownerUid:owner,sessionToken:tokenB,
    point:{latitude:0,longitude:0,accuracyMeters:10,capturedAtMs:now+2000},
    appInForeground:true,foregroundPermissionGranted:true
  })).event,null,'same approved-zone cooldown spans legitimate device handoff');
  stored=(await stateRef.get()).data();
  assert.equal(stored.zone,'inside');
  assert.equal(stored.lastEventAtMs,now-1000);
  for(const forbidden of ['point','latitude','longitude','fix','history','sessionToken'])
    assert.equal(Object.hasOwn(stored,forbidden),false);
  assert.equal(JSON.stringify(stored).includes(tokenB),false,
    'never persist the M3 device bearer token');
});

test('real Firestore: M4 v2 post-expiry future-skew fix cannot mutate geofence state',
 {timeout:90000},async t=>{
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST);
  assert.equal(process.env.GCLOUD_PROJECT,DEMO);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','');
  const app=initializeApp({projectId:DEMO},'m4-lease-end-fix-isolated');
  const db=getFirestore(app);
  t.after(async()=>{await db.terminate();await deleteApp(app);});
  const projection={projectId:STAGING_PROJECT,
    collection:name=>db.collection(name),runTransaction:fn=>db.runTransaction(fn)};
  const owner='leaseendzoneowner000006',subject='leaseendsubject000007';
  const now=1_800_000_000_000,expiresAtMs=now+1000;
  const relationUpdated=Timestamp.fromMillis(now-10_000);
  const revision=relationUpdated.seconds+':'+relationUpdated.nanoseconds;
  const sessionToken='c'.repeat(64);
  const sessionDigest=createHash('sha256')
    .update('m3-device-session:v1:'+sessionToken).digest('hex');
  const pair=owner+'__'+subject,grantPair=subject+'__'+owner;
  const stateRef=db.collection('private_geofence_states').doc(pair);
  await Promise.all([
    db.collection('friendRequests').doc(pair).set({
      senderUid:owner,recipientUid:subject,status:'accepted',
      senderConsent:true,recipientConsent:true,updatedAt:relationUpdated
    }),
    db.collection('private_geofence_zones').doc(pair).set({
      ownerUid:owner,subjectUid:subject,status:'active',
      relationRevision:revision,createdAtMs:now-6000,approvedAtMs:now-5000,
      expiresAtMs:now+3600_000,
      circle:{latitude:0,longitude:0,radiusMeters:350}
    }),
    db.collection('private_location_grants').doc(grantPair).set({
      ownerUid:subject,viewerUid:owner,enabled:true,
      relationRevision:revision,expiresAtMs,sessionDigest
    }),
    db.collection('private_location_publishers').doc(subject).set({
      ownerUid:subject,viewerUid:owner,expiresAtMs,sessionDigest
    }),
    stateRef.set({ownerUid:owner,subjectUid:subject,
      relationRevision:revision,approvedAtMs:now-5000,
      expiresAtMs:now+3600_000,zone:'outside',pending:null,streak:0,
      lastEventAtMs:null,lastSampleCapturedAtMs:now-3000,sessionDigest
    })
  ]);
  const auth={app:{options:{projectId:STAGING_PROJECT}},
    async verifyIdToken(value,revoked){
      assert.equal(value,bearer(subject));
      assert.equal(revoked,true);
      return {uid:subject,sub:subject,aud:STAGING_PROJECT,
        iss:'https://securetoken.google.com/'+STAGING_PROJECT};
    }
  };
  const service=createGeofenceService({adminAuth:auth,
    store:createFirestoreGeofenceStore(projection),
    rateLimiter:{persistent:true,consume:async()=>true},clock:()=>now});
  const evaluateAt=capturedAtMs=>service.evaluate({
    idToken:bearer(subject),ownerUid:owner,sessionToken,
    point:{latitude:0,longitude:0,accuracyMeters:10,capturedAtMs},
    appInForeground:true,foregroundPermissionGranted:true
  });
  const before=await stateRef.get();
  await assert.rejects(evaluateAt(expiresAtMs+1),GeofenceDenied);
  const after=await stateRef.get();
  assert.deepEqual(after.data(),before.data());
  assert.ok(after.updateTime.isEqual(before.updateTime),
    'post-lease capture cannot advance state, event cooldown or TTL');
  assert.equal((await evaluateAt(expiresAtMs)).evaluated,true,
    'capture at the lease-end boundary remains valid');
  const accepted=await stateRef.get();
  assert.equal(accepted.data().sessionDigest,sessionDigest);
  assert.equal(Object.hasOwn(accepted.data(),'point'),false);
  assert.equal(Object.hasOwn(accepted.data(),'sessionToken'),false);
});
