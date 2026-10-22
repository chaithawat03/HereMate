import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createNodeLocationHandler} from './edge.mjs';
import {validateStagingServiceEnvironment} from './main.mjs';

const B='m2vieweruid00000002';
const AUTH='T'.repeat(64);
const service={
  start:async({viewerUid,idToken})=>{
    assert.equal(viewerUid,B);
    assert.equal(idToken,AUTH);
    return {enabled:true,expiresAtMs:1800000060000};
  },
  stop:async()=>({enabled:false}),
  publish:async()=>({stored:true,expiresAtMs:1800000030000}),
  read:async()=>({point:{latitude:0,longitude:0,accuracyMeters:5,capturedAtMs:1800000000000},expiresAtMs:1800000030000})
};
test('Cloud Run boot guard rejects wrong project, missing opt-in, emulator and local credential keys',()=>{
  const valid={HEREMATE_M2_ENABLE_SERVER:'true',K_SERVICE:'heremate-m2-location-staging',
    GOOGLE_CLOUD_PROJECT:'heremate',PORT:'8080'};
  assert.equal(validateStagingServiceEnvironment(valid),8080);
  for(const patch of [
    {HEREMATE_M2_ENABLE_SERVER:'false'}, {K_SERVICE:'production'},
    {GOOGLE_CLOUD_PROJECT:'other'}, {GCLOUD_PROJECT:'production'},
    {FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'},
    {FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'},
    {GOOGLE_APPLICATION_CREDENTIALS:'/tmp/key.json'}, {PORT:'0'}, {PORT:'bad'}
  ])assert.throws(()=>validateStagingServiceEnvironment({...valid,...patch}));
  assert.throws(()=>validateStagingServiceEnvironment({}));
});
test('Node HTTP edge enforces strict body cap, Bearer header and no-store; no CORS wildcard',async t=>{
  const server=createServer(createNodeLocationHandler(service));
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
  const origin='http://127.0.0.1:'+server.address().port;
  const path='/v1/locations/grants/start';
  async function call(body,headers={},url=path,method='POST'){
    return fetch(origin+url,{method,headers:{'Content-Type':'application/json',...headers},
      body:method==='POST'?body:undefined});
  }
  let r=await call(JSON.stringify({viewerUid:B}),{Authorization:'Bearer '+AUTH});
  assert.equal(r.status,200);
  assert.equal((await r.json()).enabled,true);
  assert.match(r.headers.get('cache-control'),/no-store/);
  assert.equal(r.headers.get('access-control-allow-origin'),null);
  r=await call(JSON.stringify({viewerUid:B}));
  assert.equal(r.status,401);
  r=await call(JSON.stringify({viewerUid:B}),{Authorization:'Bearer '+AUTH},path+'?extra=true');
  assert.equal(r.status,404);
  r=await call('x'.repeat(1025),{Authorization:'Bearer '+AUTH});
  assert.equal(r.status,413);
  assert.deepEqual(await r.json(),{error:'payload_too_large'});
  r=await call(JSON.stringify({viewerUid:B,extra:1}),{Authorization:'Bearer '+AUTH});
  assert.equal(r.status,400);
  r=await call('',{Authorization:'Bearer '+AUTH},path,'GET');
  assert.equal(r.status,405);
});

test('duplicate Authorization request headers are denied before domain service access',async t=>{
 let calls=0;
 const never={
   start:async()=>{calls++;return {enabled:true};},
   stop:async()=>{calls++;return {enabled:false};},
   publish:async()=>{calls++;return {stored:true};},
   read:async()=>{calls++;return {point:null};}
 };
 const server=createServer(createNodeLocationHandler(never));
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 t.after(()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
 // Raw HTTP agent permits two Authorization header lines; Node normalizes
 // headers but keeps rawHeaders for a conservative duplicate check.
 const {request}=await import('node:http');
 const result=await new Promise((resolve,reject)=>{
   const req=request({
     host:'127.0.0.1',port:server.address().port,
     path:'/v1/locations/grants/start',method:'POST',
     headers:{'Content-Type':'application/json','Authorization':['Bearer '+AUTH,'Bearer '+AUTH]}
   },res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
   req.on('error',reject);
   req.end(JSON.stringify({viewerUid:B}));
 });
 assert.equal(result,401);
 assert.equal(calls,0);
});
