/**
 * Android M4 offline integration: the actual HTTPS transport -> local Node
 * routing -> real Auth Emulator JWT -> Admin Firestore transactions.
 * Only the injected fetch maps the exact approved Staging origin to loopback.
 * No Cloud Run/GCP request, phone GPS, OS notifications or live TTL proof.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';
import {createGeofenceService} from '../geofences/geofence-service.mjs';
import {createFirestoreGeofenceStore} from '../geofences/firestore-geofence-store.mjs';
import {createFirestoreGeofenceRateLimiter} from '../geofences/geofence-rate-limiter.mjs';
import {createLocationService,STAGING_PROJECT} from '../location/location-service.mjs';
import {createFirestoreLocationStore,createFirestoreLocationRateLimiter} from '../location/firestore-location-adapters.mjs';
import {createNodeGeofenceHandler} from '../geofences/geofence-edge.mjs';
import {createNodeLocationHandler} from './edge.mjs';
import {createStagingRouteHandler} from './main.mjs';
import {createM2StagingTransport} from '../../src/location/m2StagingTransport.ts';
import {createM4StagingTransport} from '../../src/geofences/m4StagingTransport.ts';

const DEMO='demo-heremate-m053';
const AUTH_HOST='127.0.0.1:9099',DB_HOST='127.0.0.1:8080';
const APPROVED_ORIGIN='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
const circle={latitude:0,longitude:0,radiusMeters:350};

test('Android M4 real JWT/HTTP/Firestore consent and event privacy (emulators only)',
  {timeout:120000},async t=>{
    // Fail before any network I/O if an operator accidentally supplies cloud
    // credentials or attempts to run outside the isolated DEMO project.
    assert.equal(process.env.GCLOUD_PROJECT,DEMO);
    assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,AUTH_HOST);
    assert.equal(process.env.FIRESTORE_EMULATOR_HOST,DB_HOST);
    assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','');
    assert.match(DEMO,/^demo-/);
    const app=initializeApp({projectId:DEMO},'m4-android-real-http-e2e');
    const auth=getAuth(app),db=getFirestore(app);
    t.after(async()=>{await db.terminate();await deleteApp(app);});
    const people=[];
    for(let i=0;i<3;i++){
      const response=await fetch(
        'http://'+AUTH_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signUp?key=offline-demo-key',
        {method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({returnSecureToken:true}),
          signal:AbortSignal.timeout(10000)}
      );
      assert.equal(response.status,200);
      const row=await response.json();
      assert.equal((await auth.verifyIdToken(row.idToken,true)).uid,row.localId);
      people.push({uid:row.localId,token:row.idToken});
    }
    t.after(async()=>{await Promise.allSettled(people.map(p=>auth.deleteUser(p.uid)));});
    const [owner,subject,stranger]=people;
    // Project projection changes ONLY the claim and Firestore adapter's
    // expected staging identifier. Actual tokens and transactions stay DEMO.
    const dbPort={projectId:STAGING_PROJECT,
      collection:name=>db.collection(name),
      runTransaction:fn=>db.runTransaction(fn)};
    const authPort={app:{options:{projectId:STAGING_PROJECT}},
      async verifyIdToken(token,revoked){
        assert.equal(revoked,true);
        const claims=await auth.verifyIdToken(token,true);
        return {...claims,aud:STAGING_PROJECT,
          iss:'https://securetoken.google.com/'+STAGING_PROJECT};
      }};
    const location=createLocationService({
      adminAuth:authPort,store:createFirestoreLocationStore(dbPort),
      rateLimiter:createFirestoreLocationRateLimiter(dbPort)
    });
    const geofences=createGeofenceService({
      adminAuth:authPort,store:createFirestoreGeofenceStore(dbPort),
      rateLimiter:createFirestoreGeofenceRateLimiter(dbPort)
    });
    const handler=createStagingRouteHandler(
      createNodeLocationHandler(location),createNodeGeofenceHandler(geofences));
    const server=createServer(handler);
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    t.after(()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
    const loopback='http://127.0.0.1:'+server.address().port;
    const fetchImpl=async(url,init)=>{
      const target=new URL(url);
      assert.equal(target.origin,APPROVED_ORIGIN);
      assert.equal(init.method,'POST');
      assert.equal(init.redirect,'error');
      assert.ok(target.pathname.startsWith('/v1/geofences/')||
        target.pathname.startsWith('/v2/locations/')||
        target.pathname==='/v1/locations/grants/stop');
      return fetch(loopback+target.pathname,init);
    };
    const ports=who=>({
      approvedCloudRunUrl:APPROVED_ORIGIN,projectId:STAGING_PROJECT,
      currentIdentity:()=>({uid:who.uid,getIdToken:async()=>who.token}),
      isForeground:()=>true,foregroundPermissionGranted:async()=>true,
      fetchImpl
    });
    const ownerM4=createM4StagingTransport(ports(owner));
    const subjectM4=createM4StagingTransport(ports(subject));
    const strangerM4=createM4StagingTransport(ports(stranger));
    const subjectM3=createM2StagingTransport({...ports(subject),useDeviceSessions:true});
    const relation=db.collection('friendRequests').doc(owner.uid+'__'+subject.uid);
    const zone=db.collection('private_geofence_zones').doc(owner.uid+'__'+subject.uid);
    const state=db.collection('private_geofence_states').doc(owner.uid+'__'+subject.uid);
    // Neither friendship nor unilateral consent may create a zone.
    await assert.rejects(ownerM4.propose(subject.uid,circle),/M4_GEOFENCE_NOT_AVAILABLE/);
    await relation.set({schemaVersion:1,senderUid:owner.uid,
      recipientUid:subject.uid,status:'accepted',senderConsent:true,
      recipientConsent:false,updatedAt:Timestamp.now()});
    await assert.rejects(ownerM4.propose(subject.uid,circle),/M4_GEOFENCE_NOT_AVAILABLE/);
    await relation.update({recipientConsent:true,updatedAt:Timestamp.now()});
    assert.equal((await ownerM4.propose(subject.uid,circle)).proposed,true);
    await assert.rejects(strangerM4.review(owner.uid),/M4_GEOFENCE_NOT_AVAILABLE/);
    const reviewed=await subjectM4.review(owner.uid);
    assert.deepEqual(reviewed.circle,circle);
    assert.ok(reviewed.proposalCreatedAtMs>0);
    // A decision for an unseen proposal version must not approve this circle.
    await assert.rejects(subjectM4.decide(owner.uid,true,
      reviewed.proposalCreatedAtMs-1),/M4_GEOFENCE_NOT_AVAILABLE/);
    assert.equal((await zone.get()).data().status,'pending');
    assert.equal((await subjectM4.decide(owner.uid,true,
      reviewed.proposalCreatedAtMs)).approved,true);
    await assert.rejects(subjectM4.evaluate(owner.uid,{
      latitude:0,longitude:0,accuracyMeters:12,capturedAtMs:Date.now()-1000
    }),/M4_GEOFENCE_NOT_AVAILABLE/,'approval alone is not an M2 publisher grant');
    assert.equal((await subjectM3.start(owner.uid)).enabled,true);
    // Four independent synthetic samples establish outside, then Enter.
    // Captures are distinct and ordered; no physical GPS or elapsed wait.
    const captured=Date.now()-10000;
    const sample=(lat,offset)=>({
      latitude:lat,longitude:0,accuracyMeters:12,capturedAtMs:captured+offset
    });
    assert.equal((await subjectM4.evaluate(owner.uid,sample(0.02,0))).event,null);
    assert.equal((await subjectM4.evaluate(owner.uid,sample(0.02,2000))).event,null);
    assert.equal((await subjectM4.evaluate(owner.uid,sample(0,4000))).event,null);
    assert.equal((await subjectM4.evaluate(owner.uid,sample(0,6000))).event,'enter');
    assert.equal((await subjectM4.evaluate(owner.uid,sample(0,6000))).event,null,
      'replayed fix cannot emit another Enter');
    const saved=(await state.get()).data();
    assert.equal(saved.zone,'inside');
    assert.ok(saved.expireAt instanceof Timestamp);
    for(const field of ['latitude','longitude','point','circle','fix','route','history'])
      assert.equal(Object.hasOwn(saved,field),false,'state cannot retain '+field);
    assert.equal((await db.collection('private_geofence_rate_limits').get()).docs
      .every(doc=>/^[0-9a-f]{64}$/.test(doc.id)),true);
    // An independent stranger cannot erase the approved zone through HTTP.
    const attempted=await fetch(loopback+'/v1/geofences/revoke',{
      method:'POST',headers:{'Content-Type':'application/json',
        Authorization:'Bearer '+stranger.token},
      body:JSON.stringify({ownerUid:owner.uid,subjectUid:subject.uid})
    });
    assert.equal(attempted.status,404);
    assert.equal((await zone.get()).exists,true);
    assert.equal((await subjectM3.stop(owner.uid)).enabled,false);
    await assert.rejects(subjectM4.evaluate(owner.uid,sample(0,8000)),
      /M4_GEOFENCE_NOT_AVAILABLE/,'STOP removes publisher authorization');
    // Restored friendship consent cannot resurrect the old grant/zone.
    await relation.update({recipientConsent:false,updatedAt:Timestamp.now()});
    await assert.rejects(subjectM4.evaluate(owner.uid,sample(0,8000)),
      /M4_GEOFENCE_NOT_AVAILABLE/);
    await relation.update({recipientConsent:true,updatedAt:Timestamp.now()});
    await assert.rejects(subjectM4.evaluate(owner.uid,sample(0,8000)),
      /M4_GEOFENCE_NOT_AVAILABLE/);
    await relation.update({status:'removed',senderConsent:false,
      recipientConsent:false,updatedAt:Timestamp.now()});
    assert.deepEqual(await subjectM4.revoke(owner.uid,subject.uid),{revoked:true});
    assert.equal((await zone.get()).exists,false);
    assert.equal((await state.get()).exists,false);
    assert.equal((await db.collection('private_location_publishers')
      .doc(subject.uid).get()).exists,false);
    assert.equal((await db.collection('private_latest_locations')
      .doc(subject.uid+'__'+owner.uid).get()).exists,false);
    assert.deepEqual(await subjectM4.revoke(owner.uid,subject.uid),{revoked:true},
      'subject revocation remains idempotent after unfriend');
  });
