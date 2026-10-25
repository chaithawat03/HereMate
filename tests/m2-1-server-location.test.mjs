import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createLocationService,LocationDenied,LocationBusy,LocationLimited,LocationInvalid,
  STAGING_PROJECT,GRANT_MS
} from '../backend/location/location-service.mjs';
import {
  createFirestoreLocationStore,createFirestoreLocationRateLimiter,
} from '../backend/location/firestore-location-adapters.mjs';
import {handleLocationHttp} from '../backend/location/http.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

const A='m2owneruid000000001',B='m2vieweruid00000002',C='m2strangeruid000003';
const pair=A+'__'+B;
let now=1800000000000;
const point=()=>({latitude:13.75,longitude:100.5,accuracyMeters:12,capturedAtMs:now-1000});
const bearer=id=>'T'.repeat(64)+id;
const relation=(patch={})=>({schemaVersion:1,senderUid:A,recipientUid:B,
  updatedAt:{seconds:Math.floor(now/1000),nanoseconds:0},
  senderConsent:true,recipientConsent:true,status:'accepted',...patch});

// Fake Firestore transaction with tracked read-before-write order. No live Firebase,
// network credentials or real GPS. Commit staged writes only on success.
function database() {
 const rows=new Map();
 let readingAfterWrite=false;
 return {
  projectId:STAGING_PROJECT,rows,
  collection(name){return {doc(id){return {key:name+'/'+id}}};},
  async runTransaction(worker) {
   const changes=[];
   let written=false;
   const tx={
    async get(ref){
     if(written){readingAfterWrite=true;throw Error('READ_AFTER_WRITE');}
     const data=rows.get(ref.key);
     return {exists:data!==undefined,data:()=>structuredClone(data)};
    },
    set(ref,data){written=true;changes.push(['set',ref.key,data]);},
    delete(ref){written=true;changes.push(['delete',ref.key]);},
   };
   const result=await worker(tx);
   for(const [op,key,data] of changes){
    if(op==='set')rows.set(key,structuredClone(data));
    else rows.delete(key);
   }
   return result;
  },
  isOrdered(){return !readingAfterWrite;}
 };
}
function setup() {
 now=1800000000000;
 const db=database();
 db.rows.set('friendRequests/'+pair,relation());
 const revoked=new Set();
 const adminAuth={app:{options:{projectId:STAGING_PROJECT}},
   async verifyIdToken(token,checkRevoked){
     assert.equal(checkRevoked,true);
     const uid=token.startsWith('T'.repeat(64))?token.slice(64):null;
     if(!uid||revoked.has(uid))throw Error('invalid or revoked');
     return {uid,sub:uid,aud:STAGING_PROJECT,iss:'https://securetoken.google.com/'+STAGING_PROJECT};
   }
 };
 const store=createFirestoreLocationStore(db);
 const rateLimiter=createFirestoreLocationRateLimiter(db,()=>now);
 const svc=createLocationService({adminAuth,store,rateLimiter,clock:()=>now});
 const start=()=>svc.start({idToken:bearer(A),viewerUid:B});
 const stop=()=>svc.stop({idToken:bearer(A),viewerUid:B});
 const publish=()=>svc.publish({idToken:bearer(A),viewerUid:B,point:point(),
  appInForeground:true,foregroundPermissionGranted:true});
 const view=()=>svc.read({idToken:bearer(B),ownerUid:A});
 return {db,svc,adminAuth,revoked,start,stop,publish,view};
}
const fails=(promise,ErrorType=LocationDenied)=>assert.rejects(promise,ErrorType);

test('startup blocks incorrect project, missing revoked-token verification, or nonpersistent rate limiter',()=>{
 const db=database(),store=createFirestoreLocationStore(db),limiter=createFirestoreLocationRateLimiter(db);
 assert.throws(()=>createFirestoreLocationStore({...db,projectId:'production'}),LocationBusy);
 assert.throws(()=>createLocationService({adminAuth:{app:{options:{projectId:'production'}},verifyIdToken(){}},store,rateLimiter:limiter}),LocationBusy);
 assert.throws(()=>createLocationService({adminAuth:{app:{options:{projectId:STAGING_PROJECT}},verifyIdToken(){}},store,rateLimiter:{persistent:false,consume(){} }}),LocationBusy);
});
test('selected friend: explicit grant, fresh publish, authorized recipient read and immediate Stop',async()=>{
 const x=setup();
 await fails(x.publish()); // No grant, even if both consent booleans true.
 await fails(x.view());
 const started=await x.start();
 assert.equal(started.enabled,true);
 assert.equal(started.expiresAtMs,now+GRANT_MS);
 const published=await x.publish();
 assert.equal(published.stored,true);
 const readResult=await x.view();
 assert.deepEqual(readResult.point,point());
 assert.equal(Object.keys(readResult).sort().join(','),'expiresAtMs,point');
 assert.deepEqual(await x.stop(),{enabled:false});
 await fails(x.view());
 await fails(x.publish());
 assert.equal(x.db.rows.has('private_latest_locations/'+pair),false);
 assert.equal(x.db.rows.has('private_location_grants/'+pair),false);
 assert.equal(x.db.isOrdered(),true);
});
test('STOP remains available on per-owner quota exhaustion and repeats do not resurrect sharing',async()=>{
 const x=setup();
 await x.start();
 await x.publish();
 // Signed-in owner's normal STOP bucket has been exhausted by another
 // device/session. Authorization is still required; a no-op reply is not enough.
 const rateLimiter={
   persistent:true,
   async consume({route}){return route!=='stop';}
 };
 const controlled=createLocationService({
   adminAuth:x.adminAuth,
   store:createFirestoreLocationStore(x.db),
   rateLimiter,clock:()=>now
 });
 const stop=()=>controlled.stop({idToken:bearer(A),viewerUid:B});
 assert.deepEqual(await stop(),{enabled:false});
 assert.equal(x.db.rows.has('private_latest_locations/'+pair),false);
 assert.equal(x.db.rows.has('private_location_grants/'+pair),false);
 assert.equal(x.db.rows.has('private_location_publishers/'+A),false);
 await fails(x.view());
 assert.deepEqual(await stop(),{enabled:false}); // idempotent
 // STOP is idempotent for every authenticated account, but one account
 // cannot erase another account's active grant or publisher lease.
 await x.start(); await x.publish();
 assert.deepEqual(await controlled.stop({idToken:bearer(C),viewerUid:B}),
   {enabled:false});
 assert.deepEqual((await x.view()).point,point());
 await stop();
 x.revoked.add(A);
 await fails(stop());
});

test('M3 capability-fenced device sessions prevent same Firebase account cross-device publishing',async()=>{
 const x=setup();
 const first=await x.svc.startDevice({idToken:bearer(A),viewerUid:B});
 assert.equal(first.enabled,true);
 assert.match(first.sessionToken,/^[0-9a-f]{64}$/);
 assert.equal(first.expiresAtMs,now+GRANT_MS);
 const privateGrant=x.db.rows.get('private_location_grants/'+pair);
 const privateLease=x.db.rows.get('private_location_publishers/'+A);
 assert.match(privateGrant.sessionDigest,/^[0-9a-f]{64}$/);
 assert.equal(privateGrant.sessionDigest,privateLease.sessionDigest);
 assert.equal(JSON.stringify([...x.db.rows.values()]).includes(first.sessionToken),false);
 const share=secret=>x.svc.publishDevice({
   idToken:bearer(A),viewerUid:B,sessionToken:secret,
   point:point(),appInForeground:true,foregroundPermissionGranted:true
 });
 const stop=secret=>x.svc.stopDevice({
   idToken:bearer(A),viewerUid:B,sessionToken:secret
 });
 // Legacy M2 publisher from a second phone has the same Firebase UID but
 // no capability and cannot inject fixes into the newer M3 lease.
 await fails(x.publish());
 await fails(share('0'.repeat(64)));
 await fails(stop('0'.repeat(64)));
 await share(first.sessionToken);
 assert.deepEqual((await x.view()).point,point());
 await stop(first.sessionToken);
 await fails(x.view());
 // A stale STOP from the first phone cannot erase the newer same-viewer
 // session created by the other phone under the same Firebase user.
 const newer=await x.svc.startDevice({idToken:bearer(A),viewerUid:B});
 assert.notEqual(newer.sessionToken,first.sessionToken);
 await fails(stop(first.sessionToken));
 await fails(share(first.sessionToken));
 await share(newer.sessionToken);
 assert.deepEqual((await x.view()).point,point());
 // A signed-in owner can emergency revoke even without the capability.
 assert.deepEqual(await x.stop(),{enabled:false});
 await fails(x.view());
});
test('M3 v2 rejects same/older GPS callbacks without replacing the latest private point',async()=>{
 const x=setup();
 const device=await x.svc.startDevice({idToken:bearer(A),viewerUid:B});
 const send=fix=>x.svc.publishDevice({
   idToken:bearer(A),viewerUid:B,sessionToken:device.sessionToken,
   point:fix,appInForeground:true,foregroundPermissionGranted:true
 });
 const old=point(),fresh={...old,latitude:13.76,capturedAtMs:now-500};
 const key='private_latest_locations/'+pair;
 await send(old);
 await send(fresh);
 assert.deepEqual((await x.view()).point,fresh);
 const stored=structuredClone(x.db.rows.get(key));
 await fails(send({...old,longitude:101}),LocationDenied);
 await fails(send({...fresh,longitude:101}),LocationDenied);
 await fails(send({...fresh,capturedAtMs:now-500.5}),LocationDenied);
 assert.deepEqual(x.db.rows.get(key),stored,
   'duplicate/out-of-order fixes never mutate private point or TTL');
 // A corrupt stored baseline must not be silently discarded to accept
 // an older or fabricated fix. No history, token or extra collection.
 x.db.rows.set(key,{...stored,point:{...fresh,capturedAtMs:'invalid'}});
 const corrupted=structuredClone(x.db.rows.get(key));
 await fails(send({...fresh,capturedAtMs:now}),LocationDenied);
 assert.deepEqual(x.db.rows.get(key),corrupted);
 // Legacy pair IDs can collide: an authenticated actor cannot overwrite
 // a different pair's private location record.
 x.db.rows.set(key,{...stored,ownerUid:C});
 const collided=structuredClone(x.db.rows.get(key));
 await fails(send({...fresh,capturedAtMs:now}),LocationDenied);
 assert.deepEqual(x.db.rows.get(key),collided);
 x.db.rows.set(key,stored);
 await x.svc.stopDevice({idToken:bearer(A),viewerUid:B,
   sessionToken:device.sessionToken});
 assert.equal(x.db.rows.has(key),false);
 const next=await x.svc.startDevice({idToken:bearer(A),viewerUid:B});
 assert.notEqual(next.sessionToken,device.sessionToken);
 await x.svc.publishDevice({idToken:bearer(A),viewerUid:B,
   sessionToken:next.sessionToken,point:old,
   appInForeground:true,foregroundPermissionGranted:true});
 assert.deepEqual((await x.view()).point,old,
   'a fresh consented device lease starts with an empty point baseline');
});

test('M3 sequential second START is denied while first device lease is active',async()=>{
 const x=setup();
 const first=await x.svc.startDevice({idToken:bearer(A),viewerUid:B});
 assert.match(first.sessionToken,/^[0-9a-f]{64}$/);
 await fails(x.svc.startDevice({idToken:bearer(A),viewerUid:B}));
 // The in-memory store does not emulate Firestore's optimistic concurrency;
 // true simultaneous START is separately verified in the Admin Emulator.
});
test('server re-reads authoritative consents and friendship each operation; cannot use a cached grant',async()=>{
 const x=setup();
 await x.start();
 await x.publish();
 x.db.rows.set('friendRequests/'+pair,relation({senderConsent:false}));
 await fails(x.view());await fails(x.publish());await fails(x.start());
 x.db.rows.set('friendRequests/'+pair,relation({senderConsent:true,recipientConsent:false,updatedAt:{seconds:Math.floor(now/1000),nanoseconds:1}}));
 await fails(x.view());await fails(x.publish());
 // Returning both consent flags to ON must not resurrect a pre-revocation grant.
 x.db.rows.set('friendRequests/'+pair,relation({updatedAt:{seconds:Math.floor(now/1000),nanoseconds:2}}));
 await fails(x.view());await fails(x.publish());
 await x.stop();
 await x.start(); await x.publish(); await x.view();
 x.db.rows.set('friendRequests/'+pair,relation({status:'removed',senderConsent:false,recipientConsent:false}));
 await fails(x.view());await fails(x.start());
 // Removal does not stop an owner from clearing a stale grant.
 assert.deepEqual(await x.stop(),{enabled:false});
});
test('a stranger cannot publish, read, stop or start grants for another actor',async()=>{
 const x=setup();await x.start();await x.publish();
 await fails(x.svc.read({idToken:bearer(C),ownerUid:A}));
 await fails(x.svc.publish({idToken:bearer(B),viewerUid:B,point:point(),appInForeground:true,foregroundPermissionGranted:true}));
 await fails(x.svc.stop({idToken:bearer(C),viewerUid:C}));
 await fails(x.svc.start({idToken:bearer(C),viewerUid:A}));
 x.revoked.add(B);
 await fails(x.view());
});
test('unverified, mismatched, expired and too-future data cannot be read or stored',async()=>{
 const x=setup();
 await fails(x.svc.start({idToken:'forged',viewerUid:B}));
 await fails(x.svc.start({idToken:bearer(A),viewerUid:'../../other'}),LocationInvalid);
 await x.start();
 for(const patch of [{latitude:91},{longitude:-181},{accuracyMeters:201},
   {accuracyMeters:NaN},{capturedAtMs:now-31_000},{capturedAtMs:now+5_001}]){
   await fails(x.svc.publish({idToken:bearer(A),viewerUid:B,
     point:{...point(),...patch},appInForeground:true,foregroundPermissionGranted:true}));
 }
 await fails(x.svc.publish({idToken:bearer(A),viewerUid:B,point:{...point(),extra:'private'},
   appInForeground:true,foregroundPermissionGranted:true}),LocationInvalid);
 await x.publish();
 now+=31_001;await fails(x.view());
 now+=GRANT_MS;await fails(x.view());await fails(x.publish());
});
test('background or missing OS foreground permission fail closed; no coordinate writes',async()=>{
 const x=setup();await x.start();
 await fails(x.svc.publish({idToken:bearer(A),viewerUid:B,
  point:point(),appInForeground:false,foregroundPermissionGranted:true}));
 await fails(x.svc.publish({idToken:bearer(A),viewerUid:B,
  point:point(),appInForeground:true,foregroundPermissionGranted:false}));
 assert.equal(x.db.rows.has('private_latest_locations/'+pair),false);
});
test('ambiguous opposite-direction relationships deny instead of merging consents',async()=>{
 const x=setup();
 x.db.rows.set('friendRequests/'+B+'__'+A,{
   senderUid:B,recipientUid:A,status:'accepted',senderConsent:true,recipientConsent:true});
 await fails(x.start());
});
test('persisted per-actor/per-route rate limiting is durable and bounded',async()=>{
 const x=setup();
 for(let i=0;i<6;i++){await x.start();await x.stop();}
 await fails(x.start(),LocationLimited);
 assert.ok([...x.db.rows.keys()].some(k=>k.startsWith('private_location_rate_limits/')));
 assert.ok(![...x.db.rows.keys()].some(k=>k.includes(A)&&k.startsWith('private_location_rate_limits/')));
});
test('one owner-wide live publisher lease is transactional; other peer and duplicate Start denied',async()=>{
 const x=setup();
 const second='m2vieweruid00000004';
 x.db.rows.set('friendRequests/'+A+'__'+second,relation({recipientUid:second}));
 await x.start();
 assert.equal(x.db.rows.get('private_location_publishers/'+A).viewerUid,B);
 await fails(x.start()); // No second publisher even for the same recipient.
 await fails(x.svc.start({idToken:bearer(A),viewerUid:second}));
 await x.publish();
 await x.view();
 // A stale STOP for unrelated recipient must not terminate the current lease.
 await x.svc.stop({idToken:bearer(A),viewerUid:second});
 assert.equal(x.db.rows.get('private_location_publishers/'+A).viewerUid,B);
 await x.view();
 await x.stop();
 assert.equal(x.db.rows.has('private_location_publishers/'+A),false);
 const next=await x.svc.start({idToken:bearer(A),viewerUid:second});
 assert.equal(next.enabled,true);
 await fails(x.view()); // Previous viewer has no active grant or lease.
});
test('expired publisher lease does not survive new grant despite delayed Firestore TTL',async()=>{
 const x=setup();
 await x.start();
 await x.publish();
 now+=GRANT_MS+1;
 await fails(x.view());
 await fails(x.publish());
 const restarted=await x.start();
 assert.equal(restarted.enabled,true);
 // Previous point deleted on fresh START; no location resurrects.
 await fails(x.view());
});
test('HTTP boundary requires bearer, exact payloads, size and no credential leaks',async()=>{
 const x=setup();
 const call=(path,body,auth=bearer(A),opts={})=>handleLocationHttp({
    method:'POST',path,contentType:'application/json',
    authorization:auth===null?'': 'Bearer '+auth,bodyText:JSON.stringify(body),...opts
  },x.svc);
 const start='/v1/locations/grants/start',readPath='/v1/locations/points/read';
 assert.equal((await call('/unknown',{})).status,404);
 assert.equal((await call(start,{viewerUid:B},null)).status,401);
 assert.equal((await call(start,{viewerUid:B,unknown:1})).status,400);
 assert.equal((await call(start,{viewerUid:B},bearer(A),{method:'GET'})).status,405);
 assert.equal((await call(start,{viewerUid:B},bearer(A),{contentType:'text/plain'})).status,415);
 assert.equal((await call(start,{viewerUid:B},bearer(A),{bodyText:'x'.repeat(1025)})).status,413);
 assert.equal((await call(start,{viewerUid:B})).status,200);
 assert.equal((await call(readPath,{ownerUid:A},bearer(C))).status,404);
 const denied=await call(readPath,{ownerUid:A},bearer(C));
 assert.deepEqual(denied.body,{error:'not_available'});
 assert.equal(denied.headers['Cache-Control'],'no-store, private, max-age=0');
 assert.doesNotMatch(JSON.stringify(denied),new RegExp(A+'|'+B+'|latitude|token','i'));
});
test('strict separation: backend offline-only, no mobile GPS publishing or Firebase client rule changes',()=>{
 const app=read('App.tsx'),eas=JSON.parse(read('eas.json')),rules=read('firebase/firestore.rules');
 const api=read('backend/location/location-service.mjs');
 const adapter=read('backend/location/firestore-location-adapters.mjs');
 assert.doesNotMatch(app,/private_latest_locations|EXPO_PUBLIC_ENABLE_M2_SHARING/);
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M2_SHARING,undefined);
 assert.match(rules,/allow read, write: if false/);
 assert.doesNotMatch(api+adapter,/firebase-admin|require\('firebase|import .*firebase|fetch\(|watchPositionAsync/);
 assert.match(adapter,/db\.runTransaction/);
 assert.match(api,/verifyIdToken\(idToken,true\)/);
 assert.match(adapter,/private_latest_locations/);
 assert.match(adapter,/private_location_grants/);
 assert.match(adapter,/private_location_rate_limits/);
 assert.match(adapter,/private_location_publishers/);
});
