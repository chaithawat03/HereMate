import test from 'node:test';
import assert from 'node:assert/strict';
import {handleLocationHttp} from '../backend/location/http.mjs';
const secret='a'.repeat(64),auth='Bearer '+'T'.repeat(72);
const body=(path,payload,patch={})=>({
  method:'POST',path,authorization:auth,contentType:'application/json',
  bodyText:JSON.stringify(payload),...patch
});
test('M3 device session API has exact separate V2 schema and no token echo on rejection',async()=>{
 let invocations=0;
 const service={
  startDevice:async({viewerUid,idToken})=>{
    invocations++;assert.equal(viewerUid,'vieweruid0000000001');
    assert.equal(idToken,auth.slice(7));
    return {enabled:true,expiresAtMs:1800000060000,sessionToken:secret};
  },
  publishDevice:async({sessionToken})=>{
    invocations++;assert.equal(sessionToken,secret);
    return {stored:true,expiresAtMs:1800000030000};
  },
  stopDevice:async({sessionToken})=>{
    invocations++;assert.equal(sessionToken,secret);
    return {enabled:false};
  }
 };
 const start='/v2/locations/sessions/start',
   pub='/v2/locations/sessions/publish',
   stop='/v2/locations/sessions/stop',
   viewerUid='vieweruid0000000001';
 const point={latitude:0,longitude:0,accuracyMeters:5,capturedAtMs:1800000000000};
 const request=[
  [start,{viewerUid}],
  [pub,{viewerUid,sessionToken:secret,point,appInForeground:true,
    foregroundPermissionGranted:true}],
  [stop,{viewerUid,sessionToken:secret}]
 ];
 for(const [path,data] of request){
   const ok=await handleLocationHttp(body(path,data),service);
   assert.equal(ok.status,200);
   assert.match(ok.headers['Cache-Control'],/no-store/);
   for(const denied of [
    body(path,{...data,extra:true}),
    body(path,data,{authorization:''}),
    body(path,data,{method:'GET'}),
    body(path,data,{bodyText:'x'.repeat(1025)})
   ]){
     const result=await handleLocationHttp(denied,service);
     assert.ok([400,401,405,413].includes(result.status));
     assert.equal(JSON.stringify(result).includes(secret),false);
   }
 }
 assert.equal(invocations,3);
});
