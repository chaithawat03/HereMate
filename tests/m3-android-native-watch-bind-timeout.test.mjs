import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  bindVerifiedForegroundWatch,ANDROID_FOREGROUND_WATCH_BIND_TIMEOUT_MS
} from '../src/location/androidForegroundWatchBind.ts';
import {createForegroundSharingController} from '../src/location/m2ForegroundSession.ts';

const deferred=()=>{
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const OWNER='androidowner0000001',PEER='androidpeer00000002';
const NOW=1_800_000_000_000;
const relation={senderUid:OWNER,recipientUid:PEER,status:'accepted',
  senderConsent:true,recipientConsent:true};

test('Android native watch bind has a bounded deadline shorter than remote lease',()=>{
  assert.equal(ANDROID_FOREGROUND_WATCH_BIND_TIMEOUT_MS,15_000);
  assert.ok(ANDROID_FOREGROUND_WATCH_BIND_TIMEOUT_MS<60_000);
});
test('hung watchPositionAsync rejects promptly and removes late native subscription exactly once',async()=>{
  const pending=deferred();let removed=0,permissionChecks=0;
  await assert.rejects(bindVerifiedForegroundWatch(
    ()=>pending.promise,async()=>{permissionChecks++;return true;},5
  ),/ANDROID_FOREGROUND_WATCH_BIND_TIMED_OUT/);
  pending.resolve({remove:()=>{removed++;}});
  await flush();
  assert.equal(removed,1);
  assert.equal(permissionChecks,0,'late native watcher must not be authorized');
});
test('stalled final permission recheck immediately removes an already-created watcher',async()=>{
  const pending=deferred();let removed=0;
  await assert.rejects(bindVerifiedForegroundWatch(
    async()=>({remove:()=>{removed++;}}),()=>pending.promise,5
  ),/ANDROID_FOREGROUND_WATCH_BIND_TIMED_OUT/);
  assert.equal(removed,1,'timeout cannot wait indefinitely for OS permission API');
  pending.resolve(true);
  await flush();
  assert.equal(removed,1,'late permission result must not remove twice or reopen watcher');
});
test('successful native bind cancels its watchdog and retains watcher until caller STOP',async()=>{
  let removed=0;
  const watcher=await bindVerifiedForegroundWatch(
    async()=>({remove:()=>{removed++;}}),async()=>true,5
  );
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(removed,0);
  watcher.remove();
  assert.equal(removed,1);
});
test('invalid timeout cannot silently disable Android native bind deadline',async()=>{
  for(const timeout of [0,-1,Infinity,NaN,15_001]){
    await assert.rejects(bindVerifiedForegroundWatch(
      async()=>({remove(){}}),async()=>true,timeout
    ),/ANDROID_FOREGROUND_WATCH_INVALID_TIMEOUT/);
  }
});
test('native bind timeout triggers authenticated remote STOP, never leaves sharing stuck starting',async()=>{
  const pending=deferred();let stops=0,removed=0,publishes=0;
  const ctrl=createForegroundSharingController({
    ownerUid:()=>OWNER,isForeground:()=>true,
    askForegroundPermission:async()=>true,
    watchForegroundFix:()=>bindVerifiedForegroundWatch(
      ()=>pending.promise,async()=>true,5
    ),
    transport:{
      start:async()=>({enabled:true,expiresAtMs:NOW+60_000}),
      publish:async()=>{publishes++;return {stored:true,expiresAtMs:NOW+30_000};},
      stop:async()=>{stops++;return {enabled:false};}
    },
    now:()=>NOW,schedule:()=>null,cancel:()=>{},onState:()=>{}
  });
  await ctrl.start(PEER,relation);
  await flush();
  assert.equal(stops,1,'a committed remote START must be revoked on timeout');
  assert.equal(ctrl.getState().phase,'off');
  pending.resolve({remove:()=>{removed++;}});
  await flush();
  assert.equal(removed,1);
  assert.equal(publishes,0);
});

test('deadline patch does not enable background location, GPS persistence or release profiles',()=>{
  const source=readFileSync(new URL('../src/location/androidForegroundWatchBind.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/startLocationUpdatesAsync|TaskManager|AsyncStorage|fetch\(|setDoc\(/);
});
