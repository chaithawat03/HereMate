/**
 * Offline M4 HTTP input/edge security tests. No Cloud Run or actual GPS access.
 * Real Firestore transaction/consent tests are in geofence-emulator.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {
 handleGeofenceHttp,MAX_GEOFENCE_REQUEST_BYTES,GEOFENCE_ROUTES
} from '../geofences/geofence-http.mjs';
import {createNodeGeofenceHandler} from '../geofences/geofence-edge.mjs';
import {
 GeofenceDenied,GeofenceInvalid,GeofenceBusy,GeofenceLimited
} from '../geofences/geofence-service.mjs';
const TOKEN='T'.repeat(72);
const A='geofenceowneruid00001',B='geofencesubjectuid002';
const circle={latitude:0,longitude:0,radiusMeters:300};
const json=body=>JSON.stringify(body);
const requestTo=(path,body,other={})=>({
 method:'POST',path,contentType:'application/json',
 authorization:'Bearer '+TOKEN,bodyText:json(body),...other
});
test('every M4 route requires strict path/body, and authenticates by token not caller UID',async()=>{
 const seen=[];
 const svc=Object.fromEntries(['propose','review','decide','revoke','evaluate']
  .map(method=>[method,async x=>{
    seen.push({method,...x});
    return {method};
  }]));
 const inputs=[
  ['/v1/geofences/propose',{subjectUid:B,circle}],
  ['/v1/geofences/review',{ownerUid:A}],
  ['/v1/geofences/decide',{ownerUid:A,approve:false,
    proposalCreatedAtMs:1_800_000_000_000}],
  ['/v1/geofences/revoke',{ownerUid:A,subjectUid:B}],
  ['/v1/geofences/evaluate',{ownerUid:A,
    point:{latitude:0,longitude:0,accuracyMeters:15,capturedAtMs:1800000000000},
    appInForeground:true,foregroundPermissionGranted:true}]
 ];
 for(const [path,body] of inputs){
   assert.deepEqual((await handleGeofenceHttp(requestTo(path,body),svc)).status,200);
   assert.equal((await handleGeofenceHttp(requestTo(path,body,{
     authorization:''
   }),svc)).status,401);
   assert.equal((await handleGeofenceHttp(requestTo(path,body,{
     contentType:'text/plain'
   }),svc)).status,415);
   assert.equal((await handleGeofenceHttp(requestTo(path,body,{
     bodyText:'{"broken"'
   }),svc)).status,400);
   assert.equal((await handleGeofenceHttp(requestTo(path,{...body,extra:'oops'}),svc)).status,400);
   assert.equal((await handleGeofenceHttp(requestTo(path,body,{
     method:'GET'
   }),svc)).status,405);
 }
 assert.equal((await handleGeofenceHttp(requestTo('/v1/geofences/decide',
   {ownerUid:A,approve:true}),svc)).status,400);
 assert.equal((await handleGeofenceHttp(requestTo('/v1/geofences/decide',
   {ownerUid:A,approve:true,proposalCreatedAtMs:1_800_000_000_000.5}),svc)).status,200);
 // HTTP validates shape; trusted service validates the version is an integer.
 assert.equal(seen.length,inputs.length+1);
 assert.ok(seen.every(x=>x.idToken===TOKEN));
 assert.equal(Object.keys(GEOFENCE_ROUTES).length,5);
 assert.equal((await handleGeofenceHttp(requestTo('/v1/geofences/unknown',{}),svc)).status,404);
 assert.equal((await handleGeofenceHttp(requestTo('/v1/geofences/review?x=1',{ownerUid:A}),svc)).status,404);
 assert.equal((await handleGeofenceHttp(requestTo('/v1/geofences/review',{ownerUid:A},{
   bodyText:'x'.repeat(MAX_GEOFENCE_REQUEST_BYTES+1)
 }),svc)).status,413);
});
test('M4 HTTP never emits stack/UID/GPS when service denies or limiter is exhausted',async()=>{
 const base={propose:async()=>null,review:async()=>null,decide:async()=>null,
   revoke:async()=>null,evaluate:async()=>null};
 for(const [err,code] of [
   [new GeofenceDenied(),404],[new GeofenceInvalid(),400],
   [new GeofenceLimited(),429],[new GeofenceBusy(),503],[Error('SECRET GPS 13.7,100.5'),503]
 ]){
   const svc={...base,review:async()=>{throw err;}};
   const x=await handleGeofenceHttp(requestTo('/v1/geofences/review',{ownerUid:A}),svc);
   assert.equal(x.status,code);
   assert.equal(x.headers['Access-Control-Allow-Origin'],undefined);
   assert.match(x.headers['Cache-Control'],/no-store/);
   assert.ok(!JSON.stringify(x).includes('SECRET'));
   assert.ok(!JSON.stringify(x).includes(TOKEN));
   assert.ok(!JSON.stringify(x).includes(A));
 }
});
test('real Node HTTP edge enforces query/credentials/framing/body cap; no CORS wildcard',async t=>{
 let count=0;
 const svc={
  propose:async()=>{count++;return {proposed:true,expiresAtMs:1800000010000};},
  review:async()=>{count++;return {circle,expiresAtMs:1800000010000};},
  decide:async()=>{count++;return {approved:true};},
  revoke:async()=>{count++;return {revoked:true};},
  evaluate:async()=>{count++;return {evaluated:true,event:null,quality:'ok'};}
 };
 const server=createServer(createNodeGeofenceHandler(svc));
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
 const origin='http://127.0.0.1:'+server.address().port;
 const endpoint='/v1/geofences/review';
 const call=async(path=endpoint,headers={},body=json({ownerUid:A}))=>
   fetch(origin+path,{method:'POST',headers:{
     'Content-Type':'application/json',Authorization:'Bearer '+TOKEN,...headers
   },body});
 let resp=await call();
 assert.equal(resp.status,200);
 assert.deepEqual((await resp.json()).circle,circle);
 assert.match(resp.headers.get('cache-control'),/no-store/);
 assert.equal(resp.headers.get('access-control-allow-origin'),null);
 assert.equal((await call(endpoint+'?debug=true')).status,404);
 assert.equal((await call(endpoint,{Authorization:''})).status,401);
 assert.equal((await call(endpoint,{},'x'.repeat(2049))).status,413);
 assert.equal((await call(endpoint,{},json({ownerUid:A,inject:true}))).status,400);
 const status=await new Promise((resolve,reject)=>{
   const req=request({
     host:'127.0.0.1',port:server.address().port,path:endpoint,method:'POST',
     headers:{'Content-Type':'application/json',
       'Authorization':['Bearer '+TOKEN,'Bearer '+TOKEN]}
   },response=>{response.resume();response.on('end',()=>resolve(response.statusCode));});
   req.on('error',reject);req.end(json({ownerUid:A}));
 });
 assert.equal(status,401);
 assert.equal(count,1);
});
