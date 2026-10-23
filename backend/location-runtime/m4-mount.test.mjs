/**
 * HTTP composition tests without any Cloud Run/Firebase credentials.
 * Confirms old M2 routing and M4 default-off; no listen() is called on import.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {
 validateStagingServiceEnvironment,createStagingRouteHandler
} from './main.mjs';
import {createNodeLocationHandler} from './edge.mjs';
import {createNodeGeofenceHandler} from '../geofences/geofence-edge.mjs';
const T='T'.repeat(70);
const peer='geofenceowneruid00001';
const env={HEREMATE_M2_ENABLE_SERVER:'true',
 K_SERVICE:'heremate-m2-location-staging',
 GOOGLE_CLOUD_PROJECT:'heremate',PORT:'8080'};
test('M4 stays default OFF and staging guard requires two distinct approvals',()=>{
 assert.equal(validateStagingServiceEnvironment(env),8080);
 assert.equal(validateStagingServiceEnvironment({
   ...env,HEREMATE_M4_ENABLE_SERVER:'false'
 }),8080);
 for(const patch of [
  {HEREMATE_M4_ENABLE_SERVER:'maybe'},
  {HEREMATE_M4_ENABLE_SERVER:'true'},
  {HEREMATE_M4_ENABLE_SERVER:'true',HEREMATE_M4_TTL_REVIEWED:'true'},
  {HEREMATE_M4_ENABLE_SERVER:'true',HEREMATE_M4_BUDGET_REVIEWED:'true'},
  {HEREMATE_M4_ENABLE_SERVER:'true',HEREMATE_M4_TTL_REVIEWED:'false',
   HEREMATE_M4_BUDGET_REVIEWED:'true'},
  {HEREMATE_M4_ENABLE_SERVER:'true',HEREMATE_M4_TTL_REVIEWED:'true',
   HEREMATE_M4_BUDGET_REVIEWED:'false'},
  {HEREMATE_M4_ENABLE_SERVER:'true',HEREMATE_M4_TTL_REVIEWED:'true',
   HEREMATE_M4_BUDGET_REVIEWED:'true',GOOGLE_CLOUD_PROJECT:'wrong'},
  {HEREMATE_M4_ENABLE_SERVER:'true',HEREMATE_M4_TTL_REVIEWED:'true',
   HEREMATE_M4_BUDGET_REVIEWED:'true',
   FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'}
 ])assert.throws(()=>validateStagingServiceEnvironment({...env,...patch}));
 assert.equal(validateStagingServiceEnvironment({...env,
   HEREMATE_M4_ENABLE_SERVER:'true',
   HEREMATE_M4_TTL_REVIEWED:'true',HEREMATE_M4_BUDGET_REVIEWED:'true'
 }),8080);
});
test('optional route composition preserves M2 and isolates M4 2KiB framing',async t=>{
 let m2=0,m4=0;
 const m2Service={
   start:async()=>{m2++;return {enabled:true,expiresAtMs:1800000000000};},
   stop:async()=>{m2++;return {enabled:false};},
   publish:async()=>{m2++;return {stored:true,expiresAtMs:1800000000000};},
   read:async()=>{m2++;return {point:null,expiresAtMs:1800000000000};}
 };
 const m4Service={
   propose:async()=>{m4++;return {proposed:true,expiresAtMs:1800000000000};},
   review:async()=>{m4++;return {circle:{latitude:0,longitude:0,radiusMeters:350},
      expiresAtMs:1800000000000};},
   decide:async()=>{m4++;return {approved:false};},
   revoke:async()=>{m4++;return {revoked:true};},
   evaluate:async()=>{m4++;return {evaluated:true,event:null,quality:'ok'};}
 };
 const locationHandler=createNodeLocationHandler(m2Service);
 const geofenceHandler=createNodeGeofenceHandler(m4Service);
 const combined=createStagingRouteHandler(locationHandler,geofenceHandler);
 const server=createServer(combined);
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
 const origin='http://127.0.0.1:'+server.address().port;
 const post=(path,body,opts={})=>fetch(origin+path,{
   method:'POST',headers:{
     'Content-Type':'application/json',
     Authorization:'Bearer '+T,...opts
   },body:JSON.stringify(body)
 });
 let r=await post('/v1/locations/grants/start',{viewerUid:peer});
 assert.equal(r.status,200);assert.equal(m2,1);assert.equal(m4,0);
 r=await post('/v1/geofences/review',{ownerUid:peer});
 assert.equal(r.status,200);assert.equal(m2,1);assert.equal(m4,1);
 assert.equal((await r.json()).circle.radiusMeters,350);
 r=await post('/v1/geofences/review?extra=true',{ownerUid:peer});
 assert.equal(r.status,404);assert.equal(m4,1);
 r=await post('/v1/geofences/review',{ownerUid:peer},{Authorization:''});
 assert.equal(r.status,401);assert.equal(m4,1);
 r=await post('/v1/geofences/review',{ownerUid:peer,padding:'x'.repeat(2050)});
 assert.equal(r.status,413);assert.equal(m4,1);
 r=await post('/v1/locations/grants/start',{
   viewerUid:peer,padding:'x'.repeat(1050)
 });
 assert.equal(r.status,413);assert.equal(m2,1);
});
test('router rejects missing handlers and does not mount M4 by importing module',()=>{
 assert.throws(()=>createStagingRouteHandler(null,()=>{}));
 assert.throws(()=>createStagingRouteHandler(()=>{},null));
});
