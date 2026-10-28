import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createM2StagingTransport} from '../src/location/m2StagingTransport.ts';
import {handleLocationHttp} from '../backend/location/http.mjs';
import {LocationDenied} from '../backend/location/location-service.mjs';
import {validatedRemoteFix} from '../src/location/m2FriendLocationView.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const OWNER='m3iosowneruid00000001';
const VIEWER='m3iosvieweruid000002';
const STRANGER='m3iosstrangeruid0003';
const TOKEN='T'.repeat(80);
const ORIGIN='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
const fix=()=>({
  latitude:13.75,longitude:100.5,accuracyMeters:18,capturedAtMs:Date.now()-500
});

function rig(){
  let actor=VIEWER,foreground=true,gpsGranted=false,consented=true;
  let gpsChecks=0;
  const calls=[];
  const service={
    async read({idToken,ownerUid}){
      if(idToken!==TOKEN||actor!==VIEWER||ownerUid!==OWNER||!consented)
        throw new LocationDenied();
      return {point:fix(),expiresAtMs:Date.now()+20_000};
    },
    async stop({idToken,viewerUid}){
      if(idToken!==TOKEN||actor!==VIEWER||viewerUid!==OWNER)
        throw new LocationDenied();
      return {enabled:false};
    }
  };
  const transport=createM2StagingTransport({
    approvedCloudRunUrl:ORIGIN,projectId:'heremate',
    currentIdentity:()=>actor?{uid:actor,getIdToken:async()=>TOKEN}:null,
    isForeground:()=>foreground,
    foregroundPermissionGranted:async()=>{gpsChecks++;return gpsGranted;},
    fetchImpl:async(url,options)=>{
      const path=new URL(url).pathname;
      calls.push({path,options});
      const result=await handleLocationHttp({
        method:options.method,path,
        contentType:options.headers['Content-Type'],
        authorization:options.headers.Authorization,bodyText:options.body
      },service);
      return {ok:result.status===200,status:result.status,
        json:async()=>result.body};
    }
  });
  return {transport,calls,gpsChecks:()=>gpsChecks,
    setActor:value=>{actor=value;},setForeground:value=>{foreground=value;},
    setGps:value=>{gpsGranted=value;},setConsent:value=>{consented=value;}};
}

test('M3 iOS/Android friend-map viewer can READ a consented friend without disclosing its own GPS',async()=>{
  const x=rig();
  const point=await x.transport.read(OWNER);
  assert.ok(validatedRemoteFix(point,Date.now()));
  assert.equal(x.gpsChecks(),0,'read-only viewer never prompts for or checks local GPS permission');
  assert.deepEqual(x.calls.map(c=>c.path),['/v1/locations/points/read']);
  assert.deepEqual(JSON.parse(x.calls[0].options.body),{ownerUid:OWNER});
  assert.equal(x.calls[0].options.redirect,'error');
  assert.equal(x.calls[0].options.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(x.calls[0].options.headers['Cache-Control'],'no-store');
  assert.equal(Object.hasOwn(JSON.parse(x.calls[0].options.body),'point'),false);
  assert.equal(Object.hasOwn(JSON.parse(x.calls[0].options.body),'appInForeground'),false);
  assert.equal(Object.hasOwn(JSON.parse(x.calls[0].options.body),'foregroundPermissionGranted'),false);
  const code=read('src/location/m2StagingTransport.ts');
  assert.match(code,/ownerUid:safePeer\(ownerUid\)\},true,false/);
  assert.doesNotMatch(code,/requestForegroundPermissionsAsync|requestBackgroundPermissionsAsync|AsyncStorage/);
});

test('no-GPS READ remains foreground-only, authenticated and server consent-checked',async()=>{
  const x=rig();
  x.setForeground(false);
  await assert.rejects(x.transport.read(OWNER),/UNAVAILABLE/);
  assert.equal(x.calls.length,0,'background read must not reach network');
  x.setForeground(true);
  await assert.rejects(x.transport.read(STRANGER),/UNAVAILABLE/);
  assert.equal(x.calls.length,1,'stranger request is denied by server');
  x.setConsent(false);
  await assert.rejects(x.transport.read(OWNER),/UNAVAILABLE/);
  assert.equal(x.calls.length,2,'revoked bilateral consent is denied by server');
  x.setConsent(true);
  x.setActor(null);
  await assert.rejects(x.transport.read(OWNER),/UNAVAILABLE/);
  assert.equal(x.calls.length,2,'signed-out read never reaches server');
  assert.equal(x.gpsChecks(),0);
});

test('M3 viewer-only GPS exemption cannot bypass START/PUBLISH permission or emergency STOP safety',async()=>{
  const x=rig();
  await assert.rejects(x.transport.start(OWNER),/UNAVAILABLE/);
  await assert.rejects(x.transport.publish(OWNER,fix()),/UNAVAILABLE/);
  assert.equal(x.calls.length,0,'GPS-disabled device cannot start or publish');
  assert.equal(x.gpsChecks(),2,'publisher operations still check local GPS permission');
  x.setForeground(false);
  assert.deepEqual(await x.transport.emergencyStop(OWNER),{enabled:false},
    'owner STOP remains available without GPS or foreground permission');
  assert.deepEqual(x.calls.map(c=>c.path),['/v1/locations/grants/stop']);
  assert.equal(x.gpsChecks(),2);
  x.setForeground(true);
  x.setGps(true);
  // Permission is still independently required on every publishing operation.
  await assert.rejects(x.transport.start(STRANGER),/UNAVAILABLE/);
  assert.equal(x.gpsChecks(),4);
});

test('late viewer identity switch after token acquisition begins never sends bearer or coordinates',async()=>{
  let actor=VIEWER,release;
  const pendingToken=new Promise(resolve=>{release=resolve;});
  let sent=0;
  const transport=createM2StagingTransport({
    approvedCloudRunUrl:ORIGIN,projectId:'heremate',
    currentIdentity:()=>actor?{uid:actor,getIdToken:()=>pendingToken}:null,
    isForeground:()=>true,
    foregroundPermissionGranted:async()=>{throw Error('read must not touch GPS');},
    fetchImpl:async()=>{sent++;throw Error('unexpected network');}
  });
  const work=transport.read(OWNER);
  await Promise.resolve();
  actor=STRANGER;
  release(TOKEN);
  await assert.rejects(work,/UNAVAILABLE/);
  assert.equal(sent,0);
});
