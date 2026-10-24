/**
 * Offline transactional regression for legacy pair-key write collisions.
 * Both authenticated pairs are valid, but owner+"__"+viewer is ambiguous.
 * Exercise the real Firestore adapters with an atomic in-memory transaction;
 * no cloud credentials, GPS, notification or deployment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createLocationService,LocationDenied,STAGING_PROJECT,UID_PATTERN
} from '../backend/location/location-service.mjs';
import {createFirestoreLocationStore} from '../backend/location/firestore-location-adapters.mjs';
import {
  createGeofenceService,GeofenceDenied
} from '../backend/geofences/geofence-service.mjs';
import {createFirestoreGeofenceStore} from '../backend/geofences/firestore-geofence-store.mjs';

const ORIGINAL_OWNER='owner000000001__nested000000002';
const ORIGINAL_VIEWER='viewer000000003';
const COLLIDING_OWNER='owner000000001';
const COLLIDING_VIEWER='nested000000002__viewer000000003';
const pair=(a,b)=>a+'__'+b;
const now=1_800_000_000_000;
const revision='1800000000:0';
const token=who=>'T'.repeat(64)+who;
const sessionToken='a'.repeat(64);
const sessionDigest=createHash('sha256')
  .update('m3-device-session:v1:'+sessionToken).digest('hex');
const circle={latitude:0,longitude:0,radiusMeters:350};
const point={latitude:0,longitude:0,accuracyMeters:12,capturedAtMs:now-1000};
const relation=(owner=COLLIDING_OWNER,viewer=COLLIDING_VIEWER)=>({
  senderUid:owner,recipientUid:viewer,status:'accepted',
  senderConsent:true,recipientConsent:true,
  updatedAt:{seconds:1800000000,nanoseconds:0}
});

function database(){
  const rows=new Map();
  return {
    projectId:STAGING_PROJECT,rows,
    collection(name){return {doc(id){return {key:name+'/'+id};}};},
    async runTransaction(work){
      const pending=[];
      const tx={
        async get(ref){
          const value=rows.get(ref.key);
          return {exists:value!==undefined,data:()=>structuredClone(value)};
        },
        set(ref,value){pending.push(['set',ref.key,structuredClone(value)]);},
        delete(ref){pending.push(['delete',ref.key]);}
      };
      const result=await work(tx);
      for(const [op,key,value] of pending){
        if(op==='set')rows.set(key,value);
        else rows.delete(key);
      }
      return result;
    }
  };
}
const auth={
  app:{options:{projectId:STAGING_PROJECT}},
  async verifyIdToken(idToken,checkRevoked){
    assert.equal(checkRevoked,true);
    if(!idToken.startsWith('T'.repeat(64)))throw Error('bad_token');
    const uid=idToken.slice(64);
    return {uid,sub:uid,aud:STAGING_PROJECT,
      iss:'https://securetoken.google.com/'+STAGING_PROJECT};
  }
};
const limiter={persistent:true,consume:async()=>true};
const location=db=>createLocationService({
  adminAuth:auth,store:createFirestoreLocationStore(db),
  rateLimiter:limiter,clock:()=>now
});
const geofence=db=>createGeofenceService({
  adminAuth:auth,store:createFirestoreGeofenceStore(db),
  rateLimiter:limiter,clock:()=>now
});
const path=(collection,a=COLLIDING_OWNER,b=COLLIDING_VIEWER)=>
  collection+'/'+pair(a,b);
const snapshot=db=>structuredClone([...db.rows]);
const unchanged=(db,before)=>assert.deepEqual(snapshot(db),before);

test('two distinct valid Firebase UID pairs share the legacy document ID',()=>{
  assert.equal(pair(ORIGINAL_OWNER,ORIGINAL_VIEWER),
    pair(COLLIDING_OWNER,COLLIDING_VIEWER));
  for(const uid of [ORIGINAL_OWNER,ORIGINAL_VIEWER,COLLIDING_OWNER,COLLIDING_VIEWER])
    assert.equal(UID_PATTERN.test(uid),true);
});
test('M2 START and M3 v2 START cannot overwrite a foreign grant or erase its GPS point',async()=>{
  for(const foreign of ['grant','point']){
    for(const route of ['start','startDevice']){
      const db=database();
      db.rows.set(path('friendRequests'),relation());
      const doc=path(foreign==='grant'?'private_location_grants':'private_latest_locations');
      db.rows.set(doc,{ownerUid:ORIGINAL_OWNER,viewerUid:ORIGINAL_VIEWER,
        expiresAtMs:now-1000});
      const before=snapshot(db),service=location(db);
      await assert.rejects(service[route]({
        idToken:token(COLLIDING_OWNER),viewerUid:COLLIDING_VIEWER
      }),LocationDenied);
      unchanged(db,before);
    }
  }
});
test('M2 and M3 v2 PUBLISH cannot overwrite another pair orphaned point',async()=>{
  for(const device of [false,true]){
    const db=database(),id=path('private_latest_locations');
    db.rows.set(path('friendRequests'),relation());
    db.rows.set(path('private_location_grants'),{
      ownerUid:COLLIDING_OWNER,viewerUid:COLLIDING_VIEWER,
      enabled:true,relationRevision:revision,expiresAtMs:now+30_000,
      ...(device?{sessionDigest}:{})
    });
    db.rows.set('private_location_publishers/'+COLLIDING_OWNER,{
      ownerUid:COLLIDING_OWNER,viewerUid:COLLIDING_VIEWER,
      expiresAtMs:now+30_000,...(device?{sessionDigest}:{})
    });
    db.rows.set(id,{ownerUid:ORIGINAL_OWNER,viewerUid:ORIGINAL_VIEWER,
      point,expiresAtMs:now+20_000});
    const before=snapshot(db),service=location(db);
    await assert.rejects(device?service.publishDevice({
      idToken:token(COLLIDING_OWNER),viewerUid:COLLIDING_VIEWER,
      sessionToken,point,appInForeground:true,foregroundPermissionGranted:true
    }):service.publish({
      idToken:token(COLLIDING_OWNER),viewerUid:COLLIDING_VIEWER,
      point,appInForeground:true,foregroundPermissionGranted:true
    }),LocationDenied);
    unchanged(db,before);
  }
});
test('M4 PROPOSE cannot replace expired foreign zone or delete orphan foreign state',async()=>{
  for(const foreign of ['zone','state']){
    const db=database();
    db.rows.set(path('friendRequests'),relation());
    db.rows.set(path(foreign==='zone'?'private_geofence_zones':'private_geofence_states'),{
      ownerUid:ORIGINAL_OWNER,subjectUid:ORIGINAL_VIEWER,
      expiresAtMs:now-1000
    });
    const before=snapshot(db);
    await assert.rejects(geofence(db).propose({
      idToken:token(COLLIDING_OWNER),subjectUid:COLLIDING_VIEWER,circle
    }),GeofenceDenied);
    unchanged(db,before);
  }
});
test('M4 subject DECIDE cannot delete a colliding foreign state',async()=>{
  const db=database();
  db.rows.set(path('friendRequests'),relation());
  db.rows.set(path('private_geofence_zones'),{
    ownerUid:COLLIDING_OWNER,subjectUid:COLLIDING_VIEWER,
    circle,status:'pending',relationRevision:revision,
    createdAtMs:now-1000,expiresAtMs:now+30_000
  });
  db.rows.set(path('private_geofence_states'),{
    ownerUid:ORIGINAL_OWNER,subjectUid:ORIGINAL_VIEWER,
    zone:'inside',expiresAtMs:now+30_000
  });
  const before=snapshot(db);
  await assert.rejects(geofence(db).decide({
    idToken:token(COLLIDING_VIEWER),ownerUid:COLLIDING_OWNER,
    approve:false,proposalCreatedAtMs:now-1000
  }),GeofenceDenied);
  unchanged(db,before);
});
test('M4 EVALUATE cannot overwrite colliding foreign transition state',async()=>{
  const db=database();
  db.rows.set(path('friendRequests'),relation());
  db.rows.set(path('private_geofence_zones'),{
    ownerUid:COLLIDING_OWNER,subjectUid:COLLIDING_VIEWER,
    circle,status:'active',relationRevision:revision,
    approvedAtMs:now-1000,expiresAtMs:now+30_000
  });
  db.rows.set(path('private_geofence_states'),{
    ownerUid:ORIGINAL_OWNER,subjectUid:ORIGINAL_VIEWER,
    zone:'inside',expiresAtMs:now+30_000
  });
  db.rows.set(path('private_location_grants',COLLIDING_VIEWER,COLLIDING_OWNER),{
    ownerUid:COLLIDING_VIEWER,viewerUid:COLLIDING_OWNER,
    enabled:true,relationRevision:revision,expiresAtMs:now+30_000
  });
  db.rows.set('private_location_publishers/'+COLLIDING_VIEWER,{
    ownerUid:COLLIDING_VIEWER,viewerUid:COLLIDING_OWNER,
    expiresAtMs:now+30_000
  });
  const before=snapshot(db);
  await assert.rejects(geofence(db).evaluate({
    idToken:token(COLLIDING_VIEWER),ownerUid:COLLIDING_OWNER,point,
    appInForeground:true,foregroundPermissionGranted:true
  }),GeofenceDenied);
  unchanged(db,before);
});
test('legitimate same-pair START and expired-zone PROPOSE remain functional',async()=>{
  const db=database();
  db.rows.set(path('friendRequests'),relation());
  db.rows.set(path('private_location_grants'),{
    ownerUid:COLLIDING_OWNER,viewerUid:COLLIDING_VIEWER,
    expiresAtMs:now-1000
  });
  db.rows.set(path('private_latest_locations'),{
    ownerUid:COLLIDING_OWNER,viewerUid:COLLIDING_VIEWER,
    point,expiresAtMs:now-1000
  });
  const started=await location(db).startDevice({
    idToken:token(COLLIDING_OWNER),viewerUid:COLLIDING_VIEWER
  });
  assert.equal(started.enabled,true);
  assert.match(started.sessionToken,/^[0-9a-f]{64}$/);
  assert.equal(db.rows.has(path('private_latest_locations')),false);
  db.rows.set(path('private_geofence_zones'),{
    ownerUid:COLLIDING_OWNER,subjectUid:COLLIDING_VIEWER,
    expiresAtMs:now-1000
  });
  db.rows.set(path('private_geofence_states'),{
    ownerUid:COLLIDING_OWNER,subjectUid:COLLIDING_VIEWER,
    zone:'outside',expiresAtMs:now-1000
  });
  assert.deepEqual(await geofence(db).propose({
    idToken:token(COLLIDING_OWNER),subjectUid:COLLIDING_VIEWER,circle
  }),{proposed:true,expiresAtMs:now+86_400_000});
  assert.equal(db.rows.has(path('private_geofence_states')),false);
  const pending=db.rows.get(path('private_geofence_zones'));
  assert.equal(pending.ownerUid,COLLIDING_OWNER);
  assert.equal(pending.subjectUid,COLLIDING_VIEWER);
  assert.equal(pending.status,'pending');
});
