import test from 'node:test';
import assert from 'node:assert/strict';
import {createForegroundSharingController} from '../src/location/m2ForegroundSession.ts';

// A native remove() and clearTimeout() cannot retract callbacks already queued
// on the Android/JS bridge. They must be scoped to their originating START.
const OWNER='owner0000000000001',PEER='friend000000000002';
const NOW=1_800_000_000_000;
const relation={senderUid:OWNER,recipientUid:PEER,status:'accepted',
  senderConsent:true,recipientConsent:true};
const point={latitude:0,longitude:0,accuracyMeters:12,capturedAtMs:NOW-1000};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

function rig(delaySecondWatch=false){
  const watches=[],alarms=[],publishes=[],states=[];
  let stops=0,starts=0,releaseSecond=null;
  const secondReady=new Promise(resolve=>{releaseSecond=resolve;});
  const ctrl=createForegroundSharingController({
    ownerUid:()=>OWNER,isForeground:()=>true,
    askForegroundPermission:async()=>true,
    watchForegroundFix:async(onFix,onError)=>{
      const watch={onFix,onError,removed:false};
      watches.push(watch);
      if(delaySecondWatch&&watches.length===2)await secondReady;
      return {remove:()=>{watch.removed=true;}};
    },
    transport:{
      start:async()=>{starts++;return {enabled:true,expiresAtMs:NOW+60_000};},
      publish:async(peer,fix)=>{
        publishes.push({peer,fix});
        return {stored:true,expiresAtMs:NOW+20_000};
      },
      stop:async()=>{stops++;return {enabled:false};}
    },
    now:()=>NOW,
    schedule:(fn,delay)=>{const alarm={fn,delay,canceled:false};alarms.push(alarm);return alarm;},
    cancel:handle=>{handle.canceled=true;},
    onState:state=>states.push(state.phase)
  });
  return {ctrl,watches,alarms,publishes,states,
    releaseSecond:()=>releaseSecond(),
    get stops(){return stops;},get starts(){return starts;}
  };
}

test('retired GPS, native-error and expiry callbacks cannot publish or STOP a newer same-account lease',async()=>{
  const r=rig();
  await r.ctrl.start(PEER,relation);
  assert.equal(r.ctrl.getState().phase,'sharing');
  const oldWatch=r.watches[0],oldAlarm=r.alarms[0];
  await r.ctrl.stop();
  assert.equal(oldWatch.removed,true);
  assert.equal(oldAlarm.canceled,true);
  await r.ctrl.start(PEER,relation);
  assert.equal(r.ctrl.getState().phase,'sharing');
  assert.equal(r.starts,2);
  oldWatch.onFix(point);
  oldWatch.onError();
  oldAlarm.fn(); // A canceled timer can already be queued on JS thread.
  await flush();
  assert.equal(r.publishes.length,0,'retired native GPS fix must never publish');
  assert.equal(r.stops,1,'retired error/timer must not revoke the new lease');
  assert.equal(r.ctrl.getState().phase,'sharing');
  r.watches[1].onFix(point);
  await flush();
  assert.deepEqual(r.publishes,[{peer:PEER,fix:point}],
    'only current-generation GPS callback can publish');
  r.watches[1].onError();
  await flush();
  assert.equal(r.ctrl.getState().phase,'off',
    'current native error must still revoke the current lease');
  assert.equal(r.stops,2);
});

test('old native callbacks cannot cancel a replacement while its watch bind is pending',async()=>{
  const r=rig(true);
  await r.ctrl.start(PEER,relation);
  const retired=r.watches[0],expired=r.alarms[0];
  await r.ctrl.stop();
  const second=r.ctrl.start(PEER,relation);
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(r.watches.length,2);
  assert.equal(r.ctrl.getState().phase,'starting');
  retired.onError();
  retired.onFix(point);
  expired.fn();
  await flush();
  assert.equal(r.ctrl.getState().phase,'starting');
  assert.equal(r.stops,1);
  assert.equal(r.publishes.length,0);
  r.releaseSecond();
  await second;
  assert.equal(r.ctrl.getState().phase,'sharing');
  assert.equal(r.starts,2);
  await r.ctrl.stop();
  assert.equal(r.stops,2);
});
