import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createM2StagingTransport,APPROVED_M2_STAGING_ORIGINS} from '../src/location/m2StagingTransport.ts';
import {handleLocationHttp} from '../backend/location/http.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const A='owner000000000001',B='friend00000000002';
const token='T'.repeat(64);
const fixedNow=1_800_000_000_000;
const point={latitude:13.5,longitude:100.2,accuracyMeters:23,capturedAtMs:fixedNow-1000};
function rig(){
 let identity={uid:A,getIdToken:async()=>token};
 let foreground=true,permission=true,requests=[],serverMode='normal',onRespond=null;
 let startCount=0,stopCount=0,readCount=0,publishCount=0;
 const backend={
  async start({idToken,viewerUid}){
   assert.equal(idToken,token);assert.equal(viewerUid,B);startCount++;
   return {enabled:true,expiresAtMs:fixedNow+60_000};
  },
  async stop({idToken,viewerUid}){
   assert.equal(idToken,token);assert.equal(viewerUid,B);stopCount++;
   return {enabled:false};
  },
  async publish({idToken,viewerUid,point:fix,appInForeground,foregroundPermissionGranted}){
   assert.equal(idToken,token);assert.equal(viewerUid,B);
   assert.deepEqual(fix,point);assert.equal(appInForeground,true);
   assert.equal(foregroundPermissionGranted,true);publishCount++;
   return {stored:true,expiresAtMs:fixedNow+20_000};
  },
  async read({idToken,ownerUid}){
   assert.equal(idToken,token);assert.equal(ownerUid,A);readCount++;
   return {point,expiresAtMs:fixedNow+20_000};
  },
 };
 const fetchImpl=async(url,init)=>{
  requests.push({url,init});
  if(serverMode==='down')throw Error('network_offline');
  if(serverMode==='malformed')return {ok:true,status:200,json:async()=>({unexpected:true})};
  if(serverMode==='untrustedPoint')return {ok:true,status:200,json:async()=>({
    point:{latitude:91,longitude:100.2,accuracyMeters:23,capturedAtMs:fixedNow-1000},
    expiresAtMs:fixedNow+20_000})};
  const route=new URL(url);
  const reply=await handleLocationHttp({
    method:init.method,path:route.pathname,contentType:init.headers['Content-Type'],
    authorization:init.headers.Authorization,bodyText:init.body
  },backend);
  if(onRespond)await onRespond();
  return {ok:reply.status===200,status:reply.status,json:async()=>reply.body};
 };
 const ports={
  approvedCloudRunUrl:APPROVED_M2_STAGING_ORIGINS[1]+'/',
  projectId:'heremate',currentIdentity:()=>identity,
  isForeground:()=>foreground,
  foregroundPermissionGranted:async()=>permission,
  fetchImpl,
 };
 const transport=createM2StagingTransport(ports);
 return {transport,ports,requests,
  setIdentity:x=>{identity=x;},setForeground:x=>{foreground=x;},
  setPermission:x=>{permission=x;},setServer:x=>{serverMode=x;},
  setOnRespond:x=>{onRespond=x;},
  get counts(){return {startCount,stopCount,readCount,publishCount};}
 };
}
test('client and backend HTTP endpoint shapes integrate with bearer only; no actor UID from client',async()=>{
 const r=rig();const t=r.transport;
 assert.deepEqual(await t.start(B),{enabled:true,expiresAtMs:fixedNow+60_000});
 assert.deepEqual(await t.publish(B,point),{stored:true,expiresAtMs:fixedNow+20_000});
 assert.deepEqual(await t.stop(B),{enabled:false});
 r.setIdentity({uid:B,getIdToken:async()=>token});
 assert.deepEqual(await t.read(A),{point,expiresAtMs:fixedNow+20_000});
 assert.deepEqual(r.counts,{startCount:1,publishCount:1,stopCount:1,readCount:1});
 assert.deepEqual(r.requests.map(x=>new URL(x.url).pathname),[
  '/v1/locations/grants/start','/v1/locations/points/publish',
  '/v1/locations/grants/stop','/v1/locations/points/read'
 ]);
 for(const x of r.requests){
  assert.equal(x.init.method,'POST');
  assert.equal(x.init.redirect,'error','Never forward GPS POST bodies to a 307/308 redirect');
  assert.equal(x.init.headers.Authorization,'Bearer '+token);
  assert.equal(x.init.headers['Cache-Control'],'no-store');
  assert.equal(x.init.headers['Content-Type'],'application/json');
  assert.equal(Object.hasOwn(JSON.parse(x.init.body),'uid'),false);
  assert.equal(Object.hasOwn(JSON.parse(x.init.body),'idToken'),false);
 }
});
test('invalid projects or non-Cloud-Run / unsafe URLs are forbidden, not accepted from UI',()=>{
 const base=rig().ports;
 for(const url of [
   'http://test.a.run.app/','https://127.0.0.1/','https://evil.com/',
   'https://my.run.app.evil.example/','https://user:pass@test.a.run.app/',
   'https://test.a.run.app/private','https://test.a.run.app/?token=private',
   // A third-party Cloud Run host has a valid Google TLS certificate but
   // must never receive HereMate Firebase bearer tokens or coordinates.
   'https://attacker-controlled-service-abc.a.run.app',
   'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app.evil.invalid',
   APPROVED_M2_STAGING_ORIGINS[1]+'/v1/locations/points/read',
   APPROVED_M2_STAGING_ORIGINS[1]+'?access=token',
   APPROVED_M2_STAGING_ORIGINS[1]+'#frag',
   'HTTPS://heremate-m2-location-staging-2inhowyo2a-as.a.run.app',
   'https://HEREMATE-M2-LOCATION-STAGING-2inhowyo2a-as.a.run.app',
 ]) assert.throws(()=>createM2StagingTransport({...base,approvedCloudRunUrl:url}),/UNAVAILABLE/);
 assert.throws(()=>createM2StagingTransport({...base,projectId:'production'}),/UNAVAILABLE/);
});
test('unsigned user, self read and identity swapped while refreshing token always fail closed',async()=>{
 const r=rig();
 r.setIdentity(null);
 await assert.rejects(r.transport.start(B),/UNAVAILABLE/);
 r.setIdentity({uid:A,getIdToken:async()=>token});
 await assert.rejects(r.transport.start(A),/UNAVAILABLE/);
 let resolve;
 r.setIdentity({uid:A,getIdToken:()=>new Promise(z=>{resolve=z;})});
 const pending=r.transport.start(B);
 await Promise.resolve();await Promise.resolve();
 r.setIdentity({uid:B,getIdToken:async()=>token});
 resolve(token);
 await assert.rejects(pending,/UNAVAILABLE/);
 assert.equal(r.requests.length,0);
});
test('local foreground and OS permission gates protect START/PUBLISH/READ but STOP is still available',async()=>{
 const r=rig();r.setForeground(false);
 await assert.rejects(r.transport.start(B),/UNAVAILABLE/);
 await assert.rejects(r.transport.publish(B,point),/UNAVAILABLE/);
 await assert.rejects(r.transport.read(B),/UNAVAILABLE/);
 assert.deepEqual(await r.transport.stop(B),{enabled:false});
 r.setForeground(true);r.setPermission(false);
 await assert.rejects(r.transport.start(B),/UNAVAILABLE/);
 await assert.rejects(r.transport.publish(B,point),/UNAVAILABLE/);
 assert.equal(r.counts.startCount,0);
});
test('network error or malformed backend response fails closed with no disclosure',async()=>{
 const r=rig();r.setServer('down');
 await assert.rejects(r.transport.start(B),/UNAVAILABLE/);
 r.setServer('malformed');
 await assert.rejects(r.transport.start(B),/UNAVAILABLE/);
 await assert.rejects(r.transport.publish(B,point),/UNAVAILABLE/);
 await assert.rejects(r.transport.stop(B),/UNAVAILABLE/);
 await assert.rejects(r.transport.read(B),/UNAVAILABLE/);
});
test('mobile M2 remains strictly unmounted; no Cloud Run URL in app, no M2 EAS flags',()=>{
 const app=read('App.tsx'),eas=JSON.parse(read('eas.json'));
 const code=read('src/location/m2StagingTransport.ts');
 assert.doesNotMatch(app,/M2FriendLocationPanel|M2SharingPanel|m2StagingTransport|EXPO_PUBLIC_ENABLE_M2/);
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M2_SHARING,undefined);
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M2_MAP,undefined);
 assert.match(code,/APPROVED_M2_STAGING_ORIGINS\.includes\(url\.origin\)/);
 assert.doesNotMatch(code,/AsyncStorage|setDoc\(|onSnapshot|requestBackgroundPermissionsAsync|startLocationUpdatesAsync|console\.log/);
});

test('foreground loss while an HTTPS READ response is pending never returns a private location',async()=>{
 const r=rig();
 r.setIdentity({uid:B,getIdToken:async()=>token});
 let unlock,arrival;
 const waiting=new Promise(resolve=>{unlock=resolve;});
 const requested=new Promise(resolve=>{arrival=resolve;});
 r.setOnRespond(async()=>{arrival();await waiting;});
 const pending=r.transport.read(A);
 await requested;
 r.setForeground(false);
 unlock();
 await assert.rejects(pending,/UNAVAILABLE/);
 assert.equal(r.requests.length,1);
});
test('GPS permission revoked during an HTTPS PUBLISH response still denies the publisher',async()=>{
 const r=rig();
 let unlock,arrival;
 const waiting=new Promise(resolve=>{unlock=resolve;});
 const requested=new Promise(resolve=>{arrival=resolve;});
 r.setOnRespond(async()=>{arrival();await waiting;});
 const pending=r.transport.publish(B,point);
 await requested;
 r.setPermission(false);
 unlock();
 await assert.rejects(pending,/UNAVAILABLE/);
 assert.equal(r.requests.length,1);
});
test('location read validates numeric finite coordinates, bounds and expiry shape',async()=>{
 const r=rig();r.setIdentity({uid:B,getIdToken:async()=>token});
 r.setServer('untrustedPoint');
 await assert.rejects(r.transport.read(A),/UNAVAILABLE/);
});

test('only the two independently reviewed Staging Cloud Run service origins are admitted',()=>{
 const baseline=rig().ports;
 assert.deepEqual(APPROVED_M2_STAGING_ORIGINS,[
  'https://heremate-m2-location-staging-976775896533.asia-southeast1.run.app',
  'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app'
 ]);
 for(const approved of APPROVED_M2_STAGING_ORIGINS){
  const t=createM2StagingTransport({...baseline,approvedCloudRunUrl:approved});
  assert.equal(typeof t.start,'function');
  assert.equal(typeof t.emergencyStop,'function');
 }
 // Alternate account/project, even under Google's Cloud Run domain: deny.
 for(const rejected of [
   'https://heremate-m2-location-staging-123456789999.asia-southeast1.run.app',
   'https://heremate-m2-location-staging-999999999999.us-central1.run.app',
   'https://not-heremate-2inhowyo2a-as.a.run.app'
 ])assert.throws(()=>createM2StagingTransport({
   ...baseline,approvedCloudRunUrl:rejected
 }),/M2_LOCATION_TRANSPORT_UNAVAILABLE/);
});
