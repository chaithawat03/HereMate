import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLocationService,LocationDenied,LocationInvalid,STAGING_PROJECT,GRANT_MS,BACKGROUND_MAX_MS,
} from '../backend/location/location-service.mjs';
import {createFirestoreLocationStore,createFirestoreLocationRateLimiter} from '../backend/location/firestore-location-adapters.mjs';
import {handleLocationHttp} from '../backend/location/http.mjs';

const A='bgowneruid00000001',B='bgvieweruid0000002';
const pair=A+'__'+B;
const H=3_600_000;
let now=1800000000000;
const bearer=id=>'T'.repeat(64)+id;
const point=()=>({latitude:13.75,longitude:100.5,accuracyMeters:12,capturedAtMs:now-1000});
const relation=(patch={})=>({schemaVersion:1,senderUid:A,recipientUid:B,
  updatedAt:{seconds:Math.floor(now/1000),nanoseconds:0},
  senderConsent:true,recipientConsent:true,status:'accepted',...patch});

function database(){
  const rows=new Map();
  return {projectId:STAGING_PROJECT,rows,
    collection(name){return {doc(id){return {key:name+'/'+id};}};},
    async runTransaction(worker){
      const changes=[];let written=false;
      const tx={
        async get(ref){if(written)throw Error('READ_AFTER_WRITE');const d=rows.get(ref.key);return {exists:d!==undefined,data:()=>structuredClone(d)};},
        set(ref,data){written=true;changes.push(['set',ref.key,data]);},
        delete(ref){written=true;changes.push(['delete',ref.key]);},
      };
      const result=await worker(tx);
      for(const [op,key,data] of changes){if(op==='set')rows.set(key,structuredClone(data));else rows.delete(key);}
      return result;
    }};
}
function setup(){
  now=1800000000000;
  const db=database();
  db.rows.set('friendRequests/'+pair,relation());
  const adminAuth={app:{options:{projectId:STAGING_PROJECT}},
    async verifyIdToken(token){const uid=token.slice(64);return {uid,sub:uid,aud:STAGING_PROJECT,iss:'https://securetoken.google.com/'+STAGING_PROJECT};}};
  const svc=createLocationService({adminAuth,store:createFirestoreLocationStore(db),
    rateLimiter:createFirestoreLocationRateLimiter(db,()=>now),clock:()=>now});
  return {db,svc,
    start:()=>svc.start({idToken:bearer(A),viewerUid:B}),
    stop:()=>svc.stop({idToken:bearer(A),viewerUid:B}),
    startBg:deadlineMs=>svc.startBackground({idToken:bearer(A),viewerUid:B,deadlineMs}),
    fgPublish:()=>svc.publish({idToken:bearer(A),viewerUid:B,point:point(),appInForeground:true,foregroundPermissionGranted:true}),
    bgPublish:()=>svc.publish({idToken:bearer(A),viewerUid:B,point:point(),appInForeground:false,foregroundPermissionGranted:true}),
    read:()=>svc.read({idToken:bearer(B),ownerUid:A}),
    grant:()=>db.rows.get('private_location_grants/'+pair),
    publisher:()=>db.rows.get('private_location_publishers/'+A),
  };
}
const fails=(p,T=LocationDenied)=>assert.rejects(p,T);

test('max background window is exactly 8 hours', () => {
  assert.equal(BACKGROUND_MAX_MS,8*H);
});

test('background publish is denied without an explicit background start', async () => {
  const x=setup();
  await x.start();
  await fails(x.bgPublish());
});

test('background start requires an active grant and a deadline within 8 h', async () => {
  const x=setup();
  await fails(x.startBg(now+H));                       // no grant yet
  await x.start();
  await fails(x.startBg(now+8*H+1),LocationInvalid);
  await fails(x.startBg(now),LocationInvalid);
  await fails(x.startBg(1.5),LocationInvalid);
  assert.deepEqual(await x.startBg(now+8*H),{background:true,deadlineMs:now+8*H});
  assert.deepEqual(x.grant().background,{consentedAtMs:now,deadlineMs:now+8*H});
});

test('background publish stores the point and renews grant + lease to min(now+60 s, deadline)', async () => {
  const x=setup();
  await x.start();
  await x.startBg(now+H);
  now+=45_000;
  const r=await x.bgPublish();
  assert.equal(r.stored,true);
  assert.equal(x.grant().expiresAtMs,now+GRANT_MS);
  assert.equal(x.publisher().expiresAtMs,now+GRANT_MS);
  assert.deepEqual((await x.read()).point,point());
  // keep renewing past the original 60 s grant
  for(let i=0;i<4;i++){now+=30_000;await x.bgPublish();}
  assert.equal(x.grant().expiresAtMs,now+GRANT_MS);
});

test('renewal never extends beyond the deadline, and publishing after it is denied', async () => {
  const x=setup();
  await x.start();
  const deadline=now+H;
  await x.startBg(deadline);
  for(let t=now+30_000;t<deadline-30_000;t+=30_000){now=t;await x.bgPublish();}
  now=deadline-20_000;
  await x.bgPublish();
  assert.equal(x.grant().expiresAtMs,deadline);
  assert.equal(x.publisher().expiresAtMs,deadline);
  now=deadline;
  await fails(x.bgPublish());
});

test('a missed renewal lets the grant lapse (no silent resurrection)', async () => {
  const x=setup();
  await x.start();
  await x.startBg(now+H);
  now+=GRANT_MS+1;
  await fails(x.bgPublish());
});

test('stop clears the background block with the grant', async () => {
  const x=setup();
  await x.start();
  await x.startBg(now+H);
  await x.stop();
  await fails(x.bgPublish());
  assert.equal(x.grant(),undefined);
});

test('consent turned off denies background publishing', async () => {
  const x=setup();
  await x.start();
  await x.startBg(now+H);
  x.db.rows.set('friendRequests/'+pair,relation({recipientConsent:false}));
  await fails(x.bgPublish());
});

test('device-session (M3) leases are never accepted for background publishing', async () => {
  const x=setup();
  await x.svc.startDevice({idToken:bearer(A),viewerUid:B});
  await fails(x.startBg(now+H));
});

test('foreground publish path is unchanged and does not need the background block', async () => {
  const x=setup();
  await x.start();
  assert.equal((await x.fgPublish()).stored,true);
  assert.equal(x.grant().expiresAtMs,1800000000000+GRANT_MS,'foreground publish does not renew');
  await fails(x.svc.publish({idToken:bearer(A),viewerUid:B,point:point(),appInForeground:false,foregroundPermissionGranted:false}));
});

test('HTTP route exists with exact keys and unauthenticated calls get 401', async () => {
  const x=setup();
  const call=(bodyText,authorization)=>handleLocationHttp({method:'POST',path:'/v1/locations/background/start',
    contentType:'application/json',authorization,bodyText},x.svc);
  assert.equal((await call('{}',undefined)).status,401);
  assert.equal((await call(JSON.stringify({viewerUid:B}),'Bearer '+bearer(A))).status,400);
  await x.start();
  const ok=await call(JSON.stringify({viewerUid:B,deadlineMs:now+H}),'Bearer '+bearer(A));
  assert.equal(ok.status,200);
  assert.deepEqual(ok.body,{background:true,deadlineMs:now+H});
});
