/** M3 Android foreground STOP must not wait on a stalled local OS prompt or
 * native GPS bind. It MUST still serialize after an in-flight remote START.
 * Offline, synthetic identities; no GPS/network/cloud access.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createForegroundSharingController} from '../src/location/m2ForegroundSession.ts';

const OWNER='androidstopowner00001',PEER='androidstopfriend0002';
const NOW=1_800_000_000_000;
const relation={senderUid:OWNER,recipientUid:PEER,status:'accepted',
  senderConsent:true,recipientConsent:true};
const deferred=()=>{
  let resolve;
  const promise=new Promise(done=>{resolve=done;});
  return {promise,resolve};
};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function bounded(promise){
  const timeout=Symbol('stop_hung');
  const result=await Promise.race([promise.then(()=>true),
    new Promise(resolve=>setTimeout(()=>resolve(timeout),500))]);
  assert.notEqual(result,timeout,'STOP must not hang on local OS/native work');
}
function rig({permission=async()=>true,remoteStart=async()=>({
  enabled:true,expiresAtMs:NOW+60_000}),watch=async()=>({remove(){}})}={}){
  let starts=0,stops=0,publishes=0;
  const states=[];
  const ctrl=createForegroundSharingController({
    ownerUid:()=>OWNER,isForeground:()=>true,
    askForegroundPermission:permission,
    watchForegroundFix:watch,
    transport:{
      start:async peer=>{assert.equal(peer,PEER);starts++;return remoteStart();},
      publish:async()=>{publishes++;return {stored:true,expiresAtMs:NOW+20_000};},
      stop:async peer=>{assert.equal(peer,PEER);stops++;return {enabled:false};}
    },
    now:()=>NOW,schedule:()=>null,cancel:()=>{},onState:s=>states.push(s.phase)
  });
  return {ctrl,states,counts:()=>({starts,stops,publishes})};
}

test('explicit STOP revokes server while native watcher binding is unresolved; late watcher removed',async()=>{
  const native=deferred();let removed=0;
  const x=rig({watch:()=>native.promise});
  const starting=x.ctrl.start(PEER,relation);
  await flush();
  assert.equal(x.ctrl.getState().phase,'starting');
  assert.equal(x.counts().starts,1);
  await bounded(x.ctrl.stop());
  assert.equal(x.ctrl.getState().phase,'off');
  assert.deepEqual(x.counts(),{starts:1,stops:1,publishes:0});
  native.resolve({remove:()=>{removed++;}});
  await starting;
  assert.equal(removed,1,'late native GPS watch must be removed exactly once');
  assert.deepEqual(x.counts(),{starts:1,stops:1,publishes:0});
  assert.equal(x.ctrl.getState().phase,'off');
});

test('STOP during indefinitely pending OS permission never sends a late START',async()=>{
  const prompt=deferred();let prompts=0;
  const x=rig({permission:()=>++prompts===1?prompt.promise:Promise.resolve(true)});
  const first=x.ctrl.start(PEER,relation);
  await flush();
  assert.equal(x.counts().starts,0,'OS permission has not resolved');
  await bounded(x.ctrl.stop());
  assert.deepEqual(x.counts(),{starts:0,stops:1,publishes:0});
  assert.equal(x.ctrl.getState().phase,'off');
  // A fresh explicit START must not be stranded behind an abandoned prompt.
  await x.ctrl.start(PEER,relation);
  assert.equal(x.ctrl.getState().phase,'sharing');
  assert.equal(x.counts().starts,1);
  prompt.resolve(true);
  await first;
  assert.equal(x.counts().starts,1,'retired permission response must not start GPS');
  assert.equal(x.ctrl.getState().phase,'sharing','old callback cannot stop new session');
  await x.ctrl.stop();
  assert.equal(x.ctrl.getState().phase,'off');
});

test('STOP must wait for an actual remote START to settle before server revoke',async()=>{
  const remote=deferred();
  const x=rig({remoteStart:()=>remote.promise});
  const starting=x.ctrl.start(PEER,relation);
  await flush();
  assert.equal(x.counts().starts,1);
  const stopping=x.ctrl.stop();
  await flush();
  assert.equal(x.counts().stops,0,'STOP cannot race a remote START commit');
  assert.equal(x.ctrl.getState().phase,'stopping');
  remote.resolve({enabled:true,expiresAtMs:NOW+60_000});
  await bounded(stopping);
  await starting;
  assert.deepEqual(x.counts(),{starts:1,stops:1,publishes:0});
  assert.equal(x.ctrl.getState().phase,'off');
});
