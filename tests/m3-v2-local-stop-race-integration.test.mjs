/** Offline integration: local Android permission/native bind must not postpone
 * an authenticated M3 v2 STOP, and an unissued START must not produce a false
 * remote STOP failure. No real GPS, Firebase, network or device is used. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createForegroundSharingController} from '../src/location/m2ForegroundSession.ts';
import {createM2StagingTransport} from '../src/location/m2StagingTransport.ts';

const OWNER='localstopowner000001',PEER='localstoppeer0000002';
const TOKEN='T'.repeat(80),CAP='a'.repeat(64);
const ORIGIN='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
const relation={senderUid:OWNER,recipientUid:PEER,status:'accepted',
  senderConsent:true,recipientConsent:true};
const deferred=()=>{
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function bounded(promise){
  let timer;
  try{
    await Promise.race([promise,new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Error('LOCAL_STOP_HUNG')),1000);
    })]);
  }finally{clearTimeout(timer);}
}
function rig({permission=async()=>true,watch=async()=>({remove(){}}),
  transportPermission=async()=>true}={}){
  const sent=[];
  const transport=createM2StagingTransport({
    approvedCloudRunUrl:ORIGIN,projectId:'heremate',useDeviceSessions:true,
    currentIdentity:()=>({uid:OWNER,getIdToken:async()=>TOKEN}),
    isForeground:()=>true,foregroundPermissionGranted:transportPermission,
    fetchImpl:async url=>{
      const path=new URL(url).pathname;
      sent.push(path);
      return {ok:true,status:200,json:async()=>path.endsWith('/start')?
        {enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAP}:
        path.endsWith('/stop')?{enabled:false}:
        {stored:true,expiresAtMs:Date.now()+20_000}};
    }
  });
  const controller=createForegroundSharingController({
    ownerUid:()=>OWNER,isForeground:()=>true,
    askForegroundPermission:permission,watchForegroundFix:watch,
    transport,now:Date.now,
    schedule:(fn,ms)=>setTimeout(fn,ms),cancel:h=>clearTimeout(h),
    onState:()=>{}
  });
  return {controller,transport,sent};
}

test('v2 STOP revokes remote lease while Android native bind stalls, and removes late watcher',async()=>{
  const native=deferred();let removed=0;
  const x=rig({watch:()=>native.promise});
  const starting=x.controller.start(PEER,relation);
  await flush();
  assert.deepEqual(x.sent,['/v2/locations/sessions/start']);
  assert.equal(x.transport.getPublisherSessionToken(OWNER,PEER),CAP);
  const stopping=x.controller.stop();
  assert.equal(x.transport.getPublisherSessionToken(OWNER,PEER),null,
    'M4 loses capability synchronously at STOP tap');
  await bounded(stopping);
  assert.equal(x.controller.getState().phase,'off');
  assert.deepEqual(x.sent,[
    '/v2/locations/sessions/start','/v2/locations/sessions/stop'
  ],'remote STOP must not wait for local native bind');
  native.resolve({remove:()=>{removed++;}});
  await starting;
  assert.equal(removed,1,'late native watcher is removed exactly once');
  assert.equal(x.transport.getPublisherSessionToken(OWNER,PEER),null);
});

test('v2 STOP during hung OS permission never sends a START or false unauthenticated STOP',async()=>{
  const pending=deferred();let prompts=0;
  const x=rig({permission:()=>++prompts===1?pending.promise:Promise.resolve(true)});
  const first=x.controller.start(PEER,relation);
  await flush();
  assert.equal(x.controller.getState().phase,'starting');
  assert.deepEqual(x.sent,[]);
  await bounded(x.controller.stop());
  assert.equal(x.controller.getState().phase,'off',
    'no remote START was issued, so no stop-unconfirmed is appropriate');
  assert.deepEqual(x.sent,[],'no bearer exists for v2 STOP');
  await bounded(x.controller.start(PEER,relation));
  assert.equal(x.controller.getState().phase,'sharing',
    'a retired native prompt must not block a new explicit START');
  assert.deepEqual(x.sent,['/v2/locations/sessions/start']);
  pending.resolve(true);
  await first;
  assert.equal(x.controller.getState().phase,'sharing');
  assert.deepEqual(x.sent,['/v2/locations/sessions/start'],
    'late permission result must not initiate another START');
  await bounded(x.controller.stop());
  assert.equal(x.controller.getState().phase,'off');
  assert.deepEqual(x.sent,[
    '/v2/locations/sessions/start','/v2/locations/sessions/stop'
  ]);
});


test('v2 STOP overtakes a hung GPS permission read, and fresh consent is not blocked by retired publish',async()=>{
  const permissionGate=deferred(),permissionEntered=deferred();
  let holdPermission=false,onNativeFix;
  const x=rig({
    watch:async onFix=>{onNativeFix=onFix;return {remove(){}};},
    transportPermission:async()=>{
      if(holdPermission){
        permissionEntered.resolve();
        await permissionGate.promise;
      }
      return true;
    }
  });
  await bounded(x.controller.start(PEER,relation));
  assert.equal(x.controller.getState().phase,'sharing');
  holdPermission=true;
  onNativeFix({latitude:13.7,longitude:100.5,accuracyMeters:12,
    capturedAtMs:Date.now()});
  await bounded(permissionEntered.promise);
  const stopping=x.controller.stop();
  assert.equal(x.transport.getPublisherSessionToken(OWNER,PEER),null,
    'the original STOP tap must immediately retire the M4 capability');
  await bounded(stopping);
  assert.equal(x.controller.getState().phase,'off');
  assert.deepEqual(x.sent,[
    '/v2/locations/sessions/start','/v2/locations/sessions/stop'
  ],'server STOP must not wait for a hung pre-send native permission read');
  holdPermission=false;
  permissionGate.resolve();
  await flush();
  await flush();
  assert.equal(x.sent.filter(path=>path.endsWith('/publish')).length,0,
    'retired GPS cannot POST after the old native read eventually resolves');
  await bounded(x.controller.start(PEER,relation));
  assert.equal(x.controller.getState().phase,'sharing');
  onNativeFix({latitude:13.7,longitude:100.5,accuracyMeters:12,
    capturedAtMs:Date.now()});
  await flush();
  await flush();
  assert.equal(x.sent.filter(path=>path.endsWith('/publish')).length,1,
    'an abandoned old publish must not block new explicitly consented GPS');
  await bounded(x.controller.stop());
  assert.equal(x.controller.getState().phase,'off');
});
