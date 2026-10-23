import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createM2StagingTransport} from '../src/location/m2StagingTransport.ts';

const SELF='ownerdeviceuid000001',PEER='viewerdeviceuid000002';
const TOKEN='T'.repeat(80),CAP='a'.repeat(64);
const ORIGIN='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fix=()=>({latitude:13.7,longitude:100.5,accuracyMeters:17,
 capturedAtMs:Date.now()-100});
function harness(extra={}){
 const calls=[];
 let who=SELF,active=true,permission=true;
 const transport=createM2StagingTransport({
  approvedCloudRunUrl:ORIGIN,projectId:'heremate',useDeviceSessions:true,
  currentIdentity:()=>who?{uid:who,getIdToken:async()=>TOKEN}:null,
  isForeground:()=>active,foregroundPermissionGranted:async()=>permission,
  fetchImpl:async(url,opts)=>{
    const path=new URL(url).pathname;
    calls.push({path,body:JSON.parse(opts.body),headers:opts.headers});
    const data=path.endsWith('/start')?
      {enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP}:
      path.endsWith('/publish')?{stored:true,expiresAtMs:Date.now()+20_000}:
      path.endsWith('/stop')?{enabled:false}:{point:fix(),expiresAtMs:Date.now()+20_000};
    return {ok:true,status:200,json:async()=>data};
  },
  ...extra
 });
 return {transport,calls,setUser:x=>who=x,setActive:x=>active=x,
  setPermission:x=>permission=x};
}
test('M3 v2 session token is opaque, in memory and binds Start/Publish/Stop',async()=>{
 const x=harness();
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
 await assert.rejects(x.transport.stop(PEER),/UNAVAILABLE/);
 assert.equal(x.calls.length,0);
 const start=await x.transport.start(PEER);
 assert.equal(start.enabled,true);
 assert.equal(Object.hasOwn(start,'sessionToken'),false);
 await x.transport.publish(PEER,fix());
 assert.deepEqual(await x.transport.stop(PEER),{enabled:false});
 assert.deepEqual(x.calls.map(r=>r.path),[
  '/v2/locations/sessions/start','/v2/locations/sessions/publish',
  '/v2/locations/sessions/stop'
 ]);
 assert.deepEqual(Object.keys(x.calls[0].body),['viewerUid']);
 assert.deepEqual(Object.keys(x.calls[1].body).sort(),[
  'appInForeground','foregroundPermissionGranted','point','sessionToken','viewerUid'
 ]);
 assert.equal(x.calls[1].body.sessionToken,CAP);
 assert.equal(x.calls[2].body.sessionToken,CAP);
 for(const row of x.calls){
  assert.equal(row.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(row.headers['Cache-Control'],'no-store');
 }
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
 await assert.rejects(x.transport.stop(PEER),/UNAVAILABLE/);
 assert.equal(x.calls.length,3);
});
test('M3 capability cannot be used after auth/background/OS permission changes',async()=>{
 const x=harness();
 await x.transport.start(PEER);
 x.setUser('secondowneruid00003');
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
 await assert.rejects(x.transport.stop(PEER),/UNAVAILABLE/);
 assert.equal(x.calls.length,1);
 const y=harness();
 await y.transport.start(PEER);
 y.setActive(false);
 await assert.rejects(y.transport.publish(PEER,fix()),/UNAVAILABLE/);
 y.setActive(true);y.setPermission(false);
 await assert.rejects(y.transport.publish(PEER,fix()),/UNAVAILABLE/);
 assert.equal(y.calls.length,1);
});
test('M3 transport drops delayed network results after Firebase account change',async()=>{
 let release;
 const deferred=new Promise(resolve=>{release=resolve;});
 const x=harness({fetchImpl:async()=>{await deferred;
  return {ok:true,status:200,json:async()=>({
    enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP
  })};
 }});
 const pending=x.transport.start(PEER);
 await Promise.resolve();await Promise.resolve();
 x.setUser('secondowneruid00003');
 release();
 await assert.rejects(pending,/UNAVAILABLE/);
 await assert.rejects(x.transport.publish(PEER,fix()),/UNAVAILABLE/);
});
test('v1 Android remains unchanged while iOS M3 and opt-in Android use v2',()=>{
 const android=read('src/location/M2AndroidStagingScreens.tsx');
 const ios=read('src/location/M3IOSStagingScreens.tsx');
 const build=read('.github/workflows/android-m2-native-staging-apk.yml');
 const eas=read('eas.json');
 assert.match(android,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS==='true'/);
 assert.match(ios,/useDeviceSessions:true/);
 assert.doesNotMatch(build,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS/);
 assert.doesNotMatch(eas,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS/);
 assert.match(read('src/location/m2StagingTransport.ts'),/deviceSession/);
});
