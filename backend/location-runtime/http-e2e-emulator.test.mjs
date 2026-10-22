/**
 * M2.4D offline HTTP E2E: Auth Emulator JWT -> actual Admin Auth verifier
 * -> M2 domain -> Firestore Admin transaction -> real local Node HTTP edge.
 *
 * Project DEMO is enforced before network I/O. A test-only projection from
 * demo claims to staging-shaped claims tests the domain independently of
 * production token signatures. Never deploy this adapter or call real GCP.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {createLocationService,STAGING_PROJECT} from '../location/location-service.mjs';
import {createFirestoreLocationStore,createFirestoreLocationRateLimiter} from '../location/firestore-location-adapters.mjs';
import {createNodeLocationHandler} from './edge.mjs';

const DEMO='demo-heremate-m053',AUTH_HOST='127.0.0.1:9099',DB_HOST='127.0.0.1:8080';
const route={
 start:'/v1/locations/grants/start',
 stop:'/v1/locations/grants/stop',
 publish:'/v1/locations/points/publish',
 read:'/v1/locations/points/read'
};
const fix=()=>({latitude:0,longitude:0,accuracyMeters:10,capturedAtMs:Date.now()-500});
test('real emulated JWT+HTTP+Admin Firestore positive and privacy negative E2E',
  {timeout:120000},async t=>{
    // Never accidentally contact actual Firebase/GCP or accept credentials.
    assert.equal(process.env.GCLOUD_PROJECT,DEMO);
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,AUTH_HOST);
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST,DB_HOST);
    assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','');
    assert.match(DEMO,/^demo-/);
    const app=initializeApp({projectId:DEMO},'heremate-m2d-http-e2e');
    const auth=getAuth(app),db=getFirestore(app);
    t.after(async()=>{await db.terminate();await deleteApp(app);});
    const identities=[];
    for(let i=0;i<3;i++){
      const response=await fetch(
        'http://'+AUTH_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signUp?key=offline-demo-key',
        {method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({returnSecureToken:true}),
          signal:AbortSignal.timeout(10000)}
      );
      assert.equal(response.status,200);
      const user=await response.json();
      assert.match(user.localId,/^[A-Za-z0-9_-]{12,128}$/);
      assert.ok(user.idToken.length>64);
      // This is actual Firebase Admin SDK verification of the Auth emulator JWT.
      const claims=await auth.verifyIdToken(user.idToken,true);
      assert.equal(claims.uid,user.localId);
      assert.equal(claims.aud,DEMO);
      identities.push({uid:user.localId,token:user.idToken});
    }
    t.after(async()=>{
      await Promise.allSettled(identities.map(x=>auth.deleteUser(x.uid)));
    });
    const [owner,viewer,stranger]=identities;
    // Real Firestore transactions, but project identifier projected only for
    // domain contract compatibility with staging; no production connection.
    const dbPort={
      projectId:STAGING_PROJECT,
      collection:name=>db.collection(name),
      runTransaction:fn=>db.runTransaction(fn)
    };
    const authPort={
      app:{options:{projectId:STAGING_PROJECT}},
      async verifyIdToken(token,revoked){
        assert.equal(revoked,true);
        const verified=await auth.verifyIdToken(token,true);
        return {...verified,aud:STAGING_PROJECT,
          iss:'https://securetoken.google.com/'+STAGING_PROJECT};
      }
    };
    const service=createLocationService({
      adminAuth:authPort,
      store:createFirestoreLocationStore(dbPort),
      rateLimiter:createFirestoreLocationRateLimiter(dbPort)
    });
    const server=createServer(createNodeLocationHandler(service));
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    t.after(()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
    const origin='http://127.0.0.1:'+server.address().port;
    async function call(who,name,body){
      const response=await fetch(origin+route[name],{
        method:'POST',
        headers:{'Content-Type':'application/json',
          'Authorization':'Bearer '+(who?.token??'bad-token'),
          'Cache-Control':'no-store'},
        body:JSON.stringify(body),
        signal:AbortSignal.timeout(10000)
      });
      assert.match(response.headers.get('Cache-Control'),/no-store/);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
      return {status:response.status,body:await response.json()};
    }
    const relationRef=db.collection('friendRequests').doc(owner.uid+'__'+viewer.uid);
    const relation={
      schemaVersion:1,senderUid:owner.uid,recipientUid:viewer.uid,
      status:'accepted',senderConsent:true,recipientConsent:false,
      updatedAt:Timestamp.now()
    };
    await relationRef.set(relation);
    assert.equal((await call(owner,'start',{viewerUid:viewer.uid})).status,404,
      'friend consent OFF blocks publishing');
    assert.equal((await call(viewer,'read',{ownerUid:owner.uid})).status,404);
    assert.equal((await call(stranger,'read',{ownerUid:owner.uid})).status,404);
    await relationRef.update({recipientConsent:true,
      updatedAt:Timestamp.fromMillis(Date.now()+1)});
    const started=await call(owner,'start',{viewerUid:viewer.uid});
    assert.equal(started.status,200);
    assert.equal(started.body.enabled,true);
    assert.ok(started.body.expiresAtMs>Date.now());
    assert.equal((await call(owner,'start',{viewerUid:viewer.uid})).status,404,
      'single owner publisher lease denies overlapping Start');
    const published=await call(owner,'publish',{
      viewerUid:viewer.uid,point:fix(),
      appInForeground:true,foregroundPermissionGranted:true
    });
    assert.equal(published.status,200);
    const viewed=await call(viewer,'read',{ownerUid:owner.uid});
    assert.equal(viewed.status,200);
    assert.equal(viewed.body.point.latitude,0);
    assert.equal(viewed.body.point.longitude,0);
    assert.ok(viewed.body.expiresAtMs<=started.body.expiresAtMs);
    assert.equal((await call(stranger,'read',{ownerUid:owner.uid})).status,404);
    // STOP intentionally returns an idempotent success for its OWN actor pair,
    // even without a friendship. Stranger cannot revoke the owner's lease.
    assert.equal((await call(stranger,'stop',{viewerUid:viewer.uid})).status,200);
    assert.equal((await call(viewer,'read',{ownerUid:owner.uid})).status,200);
    assert.equal((await call(viewer,'publish',{
      viewerUid:owner.uid,point:fix(),
      appInForeground:true,foregroundPermissionGranted:true
    })).status,404);
    await relationRef.update({recipientConsent:false,
      updatedAt:Timestamp.fromMillis(Date.now()+2000)});
    assert.equal((await call(viewer,'read',{ownerUid:owner.uid})).status,404,
      'consent revocation denies existing grant immediately');
    await relationRef.update({recipientConsent:true,
      updatedAt:Timestamp.fromMillis(Date.now()+3000)});
    assert.equal((await call(viewer,'read',{ownerUid:owner.uid})).status,404,
      'consent restored never revives old grant');
    assert.equal((await call(owner,'stop',{viewerUid:viewer.uid})).status,200);
    assert.equal((await call(viewer,'read',{ownerUid:owner.uid})).status,404);
    assert.equal((await call(owner,'start',{viewerUid:viewer.uid})).status,200);
    assert.equal((await call(owner,'publish',{
      viewerUid:viewer.uid,point:fix(),
      appInForeground:true,foregroundPermissionGranted:true
    })).status,200);
    await auth.updateUser(viewer.uid,{disabled:true});
    assert.equal((await call(viewer,'read',{ownerUid:owner.uid})).status,404,
      'Admin Auth refuses disabled Firebase account at request time');
    await auth.updateUser(viewer.uid,{disabled:false});
    const stopped=await call(owner,'stop',{viewerUid:viewer.uid});
    assert.deepEqual(stopped,{status:200,body:{enabled:false}});
    for(const col of ['private_location_grants','private_latest_locations','private_location_publishers']){
      const docId=col==='private_location_publishers'?owner.uid:owner.uid+'__'+viewer.uid;
      assert.equal((await db.collection(col).doc(docId).get()).exists,false);
    }
    const noToken=await call(null,'start',{viewerUid:viewer.uid});
    assert.equal(noToken.status,401);
    assert.ok(!JSON.stringify(noToken).includes(owner.uid));
  });
