import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  BACKGROUND_TASK,clampDeadline,shouldPublish,decideOnFailure,MAX_CONSECUTIVE_FAILURES,LOCATION_TASK_OPTIONS,MAX_FIX_PUBLISH_AGE_MS,
} from '../src/location/background/backgroundPolicy.ts';
import {createBackgroundSharing} from '../src/location/background/backgroundSharing.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const H=3_600_000;
const ME='owner_uid_0000001',PEER='friend_uid_000002';
const fix=(t)=>({latitude:13.75,longitude:100.5,accuracyMeters:12,capturedAtMs:t});

function rig({fg=true,bg=true,stored=null,running=false,uid=ME,startFails=false,publishFails=false,stopFails=false,bgStartFails=false,updatesFail=false,stopRecord=null}={}){
  let now=1_800_000_000_000;
  const log=[];let state=stored;let record=stopRecord;let isRunning=running;let currentUid=uid;let failPublish=publishFails;
  const ports={
    now:()=>now,
    currentUid:()=>currentUid,
    store:{load:async()=>state,save:async s=>{state=s;log.push(s?'save':'clear');},
      loadStop:async()=>record,saveStop:async r=>{record=r;}},
    location:{
      requestForeground:async()=>{log.push('perm-fg');return fg;},
      requestBackground:async()=>{log.push('perm-bg');return bg;},
      requestNotifications:async()=>{log.push('perm-notif');},
      startUpdates:async()=>{log.push('start-updates');if(updatesFail)throw Error('fgs-not-allowed');isRunning=true;},
      stopUpdates:async()=>{log.push('stop-updates');isRunning=false;},
      isRunning:async()=>isRunning,
    },
    transport:{
      start:async p=>{log.push('grant:'+p);if(startFails)throw Error('busy');return {enabled:true,expiresAtMs:now+60_000};},
      startBackground:async(p,d)=>{log.push('bg-start:'+p+':'+(d-now));if(bgStartFails)throw Error('denied');return {background:true,deadlineMs:d};},
      publishBackground:async(p,f)=>{log.push('publish:'+p);if(failPublish)throw Error('M2_LOCATION_TRANSPORT_UNAVAILABLE');return {stored:true,expiresAtMs:now+30_000};},
      stop:async p=>{log.push('grant-stop:'+p);if(stopFails)throw Error('offline');return {enabled:false};},
    },
  };
  const c=createBackgroundSharing(ports);
  return {c,log,state:()=>state,advance:ms=>{now+=ms;},now:()=>now,setUid:u=>{currentUid=u;},
    setPublishFails:v=>{failPublish=v;},running:()=>isRunning,record:()=>record};
}

test('policy constants', () => {
  assert.equal(BACKGROUND_TASK,'heremate.background-location');
  assert.equal(clampDeadline(1000,1),1000+H);
  assert.equal(clampDeadline(1000,4),1000+4*H);
  assert.equal(clampDeadline(1000,8),1000+8*H);
  assert.throws(()=>clampDeadline(1000,2),/INVALID_BACKGROUND_HOURS/);
  assert.equal(shouldPublish({deadlineMs:10,stopped:false},9),true);
  assert.equal(shouldPublish({deadlineMs:10,stopped:false},10),false);
  assert.equal(shouldPublish({deadlineMs:10,stopped:true},5),false);
  assert.equal(MAX_CONSECUTIVE_FAILURES,4);
  assert.equal(decideOnFailure(1),'retry');
  assert.equal(decideOnFailure(4),'stop');
  // C3: time-based heartbeat so a stationary phone keeps renewing the grant.
  assert.equal(LOCATION_TASK_OPTIONS.distanceInterval,0);
  assert.equal(LOCATION_TASK_OPTIONS.timeInterval,20000);
  assert.equal(MAX_FIX_PUBLISH_AGE_MS,25000);
  assert.equal(LOCATION_TASK_OPTIONS.foregroundService.notificationTitle,'HereMate กำลังแชร์ตำแหน่ง');
  assert.equal(LOCATION_TASK_OPTIONS.foregroundService.killServiceOnDestroy,false);
});

test('start: permissions, grant, server background block, persisted state, then updates', async () => {
  const r=rig();
  await r.c.start({peerId:PEER,hours:4});
  assert.deepEqual(r.log,['perm-fg','perm-bg','perm-notif','grant:'+PEER,'bg-start:'+PEER+':'+4*H,'save','start-updates']);
  assert.deepEqual(r.state(),{ownerUid:ME,peerId:PEER,deadlineMs:r.now()+4*H});
  assert.deepEqual(r.c.current(),{withId:PEER,deadlineMs:r.now()+4*H});
});

test('start tolerates an already-active foreground grant', async () => {
  const r=rig({startFails:true});
  await r.c.start({peerId:PEER,hours:1});
  assert.ok(r.log.includes('bg-start:'+PEER+':'+H));
});

test('background_permission_denied_keeps_foreground: no grant change, no updates', async () => {
  const r=rig({bg:false});
  await assert.rejects(r.c.start({peerId:PEER,hours:1}),/BACKGROUND_PERMISSION_DENIED/);
  assert.deepEqual(r.log,['perm-fg','perm-bg']);
  assert.equal(r.c.current(),null);
  const r2=rig({fg:false});
  await assert.rejects(r2.c.start({peerId:PEER,hours:1}),/BACKGROUND_PERMISSION_DENIED/);
  assert.deepEqual(r2.log,['perm-fg']);
});

test('task publishes the newest fix while before the deadline', async () => {
  const r=rig();
  await r.c.start({peerId:PEER,hours:1});
  r.log.length=0;
  await r.c.onLocations([fix(r.now()-5000),fix(r.now()-1000)]);
  assert.deepEqual(r.log,['publish:'+PEER]);
});

test('deadline reached: the task stops updates, stops the grant and clears state', async () => {
  const r=rig();
  await r.c.start({peerId:PEER,hours:1});
  r.advance(H);
  r.log.length=0;
  await r.c.onLocations([fix(r.now())]);
  assert.deepEqual(r.log,['stop-updates','grant-stop:'+PEER,'clear']);
  assert.equal(r.c.current(),null);
  assert.equal(r.c.lastStopped().reason,'deadline');
});

test('account change stops sharing (signout)', async () => {
  const r=rig();
  await r.c.start({peerId:PEER,hours:1});
  r.setUid('someone_else_0001');
  await r.c.onLocations([fix(r.now())]);
  assert.equal(r.c.current(),null);
  assert.equal(r.c.lastStopped().reason,'signout');
  assert.ok(!r.log.includes('grant-stop:'+PEER),'I10: no STOP sent under another account');
  assert.equal(r.log.filter(l=>l.startsWith('publish')).length,0);
});

test('repeated server/network failures stop sharing (revoked); a success resets the count', async () => {
  const r=rig();
  await r.c.start({peerId:PEER,hours:1});
  r.setPublishFails(true);
  for(let i=0;i<3;i++)await r.c.onLocations([fix(r.now())]);
  assert.ok(r.c.current(),'still running after 3 failures');
  r.setPublishFails(false);
  await r.c.onLocations([fix(r.now())]);
  r.setPublishFails(true);
  for(let i=0;i<3;i++)await r.c.onLocations([fix(r.now())]);
  assert.ok(r.c.current(),'count was reset by the success');
  await r.c.onLocations([fix(r.now())]);
  assert.equal(r.c.current(),null);
  assert.equal(r.c.lastStopped().reason,'revoked');
});

test('stop clears state even when the network stop fails', async () => {
  const r=rig({stopFails:true});
  await r.c.start({peerId:PEER,hours:1});
  await r.c.stop('user');
  assert.equal(r.state(),null);
  assert.equal(r.running(),false);
});

test('expired_deadline_not_resumed', async () => {
  const r=rig({stored:{ownerUid:ME,peerId:PEER,deadlineMs:1_800_000_000_000-1},running:true});
  assert.equal(await r.c.resumeOnLaunch(),'expired');
  assert.ok(r.log.includes('stop-updates'));
  assert.ok(!r.log.includes('start-updates'));
  assert.equal(r.state(),null);
  assert.equal(r.c.lastStopped().reason,'deadline');
  assert.equal(r.c.lastStopped().atMs,1_800_000_000_000-1);
});

test('resume: valid state restarts killed updates; no state stops stray updates', async () => {
  const r=rig({stored:{ownerUid:ME,peerId:PEER,deadlineMs:1_800_000_000_000+H},running:false});
  assert.equal(await r.c.resumeOnLaunch(),'running');
  assert.deepEqual(r.log.filter(l=>!/save|clear/.test(l)),['grant:'+PEER,'bg-start:'+PEER+':'+H,'start-updates'],
    'C3: re-establishes the server share for the remaining deadline before restarting updates');
  assert.deepEqual(r.c.current(),{withId:PEER,deadlineMs:1_800_000_000_000+H});
  const r2=rig({stored:null,running:true});
  assert.equal(await r2.c.resumeOnLaunch(),'none');
  assert.deepEqual(r2.log,['stop-updates']);
  const r3=rig({stored:{ownerUid:'other_owner_00001',peerId:PEER,deadlineMs:1_800_000_000_000+H}});
  assert.equal(await r3.c.resumeOnLaunch(),'none','another account never resumes');
});

test('transport: background methods exist, background publish skips the foreground gate', () => {
  const src=read('src/location/m2StagingTransport.ts');
  assert.match(src,/async startBackground\(peerUid:string,deadlineMs:number\)/);
  assert.match(src,/'\/v1\/locations\/background\/start',\{viewerUid,deadlineMs\},true\)/);
  assert.match(src,/async publishBackground\(peerUid:string,fix:ShareFix\)/);
  assert.match(src,/appInForeground:false,foregroundPermissionGranted:true\n?\s*\},false\)/);
});

test('C3: deferred fixes older than 25 s are skipped without counting a failure', async () => {
  const r=rig();
  await r.c.start({peerId:PEER,hours:1});
  r.log.length=0;
  r.setPublishFails(true);
  for(let i=0;i<6;i++)await r.c.onLocations([fix(r.now()-26_000)]);
  assert.deepEqual(r.log,[]);
  assert.ok(r.c.current(),'not stopped by stale deferred deliveries');
});

test('C3: resume stops (revoked) when the server share cannot be re-established', async () => {
  const r=rig({stored:{ownerUid:ME,peerId:PEER,deadlineMs:1_800_000_000_000+H},bgStartFails:true});
  assert.equal(await r.c.resumeOnLaunch(),'stopped');
  assert.equal(r.c.current(),null);
  assert.equal(r.c.lastStopped().reason,'revoked');
  assert.ok(!r.log.includes('start-updates'));
});

test('I4: the before-grant hook runs only after both permissions are granted', async () => {
  const r=rig();
  await r.c.start({peerId:PEER,hours:1,beforeGrant:async()=>{r.log.push('hook');}});
  assert.deepEqual(r.log.slice(0,5),['perm-fg','perm-bg','perm-notif','hook','grant:'+PEER]);
  const r2=rig({bg:false});
  let called=false;
  await assert.rejects(r2.c.start({peerId:PEER,hours:1,beforeGrant:async()=>{called=true;}}),/BACKGROUND_PERMISSION_DENIED/);
  assert.equal(called,false);
});

test('I5: the stop record is persisted and restored on the next launch', async () => {
  const r=rig();
  await r.c.start({peerId:PEER,hours:1});
  r.advance(H);
  await r.c.onLocations([fix(r.now())]);
  assert.deepEqual(r.record(),{atMs:r.now(),reason:'deadline'});
  const r2=rig({stopRecord:{atMs:123,reason:'revoked'}});
  assert.equal(await r2.c.resumeOnLaunch(),'none');
  assert.deepEqual(r2.c.lastStopped(),{atMs:123,reason:'revoked'});
});

test('I9: a failed start leaves no phantom active state', async () => {
  const r=rig({updatesFail:true});
  await assert.rejects(r.c.start({peerId:PEER,hours:1}),/fgs-not-allowed/);
  assert.equal(r.c.current(),null);
  assert.equal(r.state(),null);
  assert.ok(r.log.includes('grant-stop:'+PEER),'server share rolled back');
});
