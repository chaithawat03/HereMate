import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createForegroundFriendMapPoller,ANDROID_FRIEND_MAP_POLL_MS,
  ANDROID_FRIEND_MAP_READ_LIMIT_PER_TICK,ANDROID_FRIEND_MAP_MAX_READS_PER_60S
} from '../src/location/androidFriendMapPoller.ts';

const A='iosvieweraccount0001',B='iosvieweraccount0002';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function rig(extra={}){
  let uid=A,foreground=true,platform='ios',now=1_800_000_000_000,reads=0;
  const intervals=[],events=[];
  const controller=createForegroundFriendMapPoller({
    isSupportedPlatform:()=>platform==='ios'||platform==='android',
    isForeground:()=>foreground,currentUid:()=>uid,now:()=>now,
    scheduleInterval:(fn,ms)=>{const row={fn,ms,cancelled:false};intervals.push(row);return row;},
    cancelInterval:row=>{row.cancelled=true;},
    refresh:async()=>{reads++;},
    onActive:value=>events.push(value),
    ...extra
  });
  return {controller,intervals,events,
    reads:()=>reads,tick:()=>intervals.at(-1).fn(),
    setUid:value=>{uid=value;},setPlatform:value=>{platform=value;},
    setForeground:value=>{foreground=value;},advance:ms=>{now+=ms;}};
}

test('iOS requires explicit foreground opt-in; bounded read-only batches',async()=>{
  const x=rig();
  assert.equal(x.reads(),0,'mount never polls before user opt-in');
  assert.equal(ANDROID_FRIEND_MAP_POLL_MS,30_000);
  assert.equal(ANDROID_FRIEND_MAP_READ_LIMIT_PER_TICK,8);
  assert.ok(ANDROID_FRIEND_MAP_MAX_READS_PER_60S<=30);
  assert.equal(x.controller.start(),true);
  await flush();
  assert.equal(x.reads(),1);
  assert.equal(x.intervals[0].ms,30_000);
  x.advance(30_000);x.tick();await flush();
  assert.equal(x.reads(),2);
  x.advance(1_000);x.tick();await flush();
  assert.equal(x.reads(),2,'rolling-minute quota cannot be bypassed by extra timers');
  x.controller.stop();
  assert.deepEqual(x.events,[true,false]);
  x.tick();await flush();
  assert.equal(x.reads(),2,'late canceled interval must not read');
});

test('iOS account/background/platform changes fail closed without automatic restart',async()=>{
  const x=rig();
  x.setPlatform('web');assert.equal(x.controller.start(),false);
  x.setPlatform('ios');x.setForeground(false);
  assert.equal(x.controller.start(),false);
  x.setForeground(true);x.setUid(null);
  assert.equal(x.controller.start(),false);
  x.setUid(A);assert.equal(x.controller.start(),true);
  await flush();
  x.setUid(B);x.tick();await flush();
  assert.equal(x.controller.isActive(),false);
  assert.equal(x.reads(),1);
  x.setUid(A);assert.equal(x.controller.start(),true);
  x.setForeground(false);x.tick();await flush();
  assert.equal(x.controller.isActive(),false);
  assert.equal(x.reads(),2);
  x.setForeground(true);
  assert.equal(x.controller.isActive(),false,'foreground resume cannot silently opt in');
  x.controller.dispose();
  assert.equal(x.controller.start(),false);
});

test('pending old iOS account HTTP batch cannot block or unlock new account',async()=>{
  const resolvers=[],calls=[];
  let uid=A;
  const x=rig({
    currentUid:()=>uid,
    refresh:()=>{calls.push(uid);return new Promise(resolve=>resolvers.push(resolve));}
  });
  x.controller.start();await flush();
  assert.deepEqual(calls,[A]);
  const oldTick=x.intervals[0].fn;
  x.controller.stop();uid=B;
  assert.equal(x.controller.start(),true);
  await flush();
  assert.deepEqual(calls,[A,B]);
  oldTick();await flush();
  assert.deepEqual(calls,[A,B]);
  resolvers[0]();await flush();
  x.advance(30_000);x.tick();await flush();
  assert.deepEqual(calls,[A,B],'old completion cannot unlock new in-flight batch');
  resolvers[1]();await flush();
  x.tick();await flush();
  assert.deepEqual(calls,[A,B,B]);
  resolvers[2]();await flush();
  x.controller.stop();
});

test('iOS foreground map uses existing server ACL; no GPS/push or EAS auto-enable',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const panel=read('src/location/M2FriendLocationPanel.tsx');
  const poller=read('src/location/androidFriendMapPoller.ts');
  const ios=read('src/location/M3IOSStagingScreens.tsx');
  const eas=JSON.parse(read('eas.json'));
  assert.match(panel,/createForegroundFriendMapPoller/);
  assert.match(panel,/\['android','ios'\]\.includes\(Platform\.OS\)/);
  assert.match(panel,/isSupportedPlatform:\(\)=>Platform\.OS==='android'\|\|Platform\.OS==='ios'/);
  assert.match(panel,/poller\.current\?\.start\(\)/);
  assert.match(panel,/poller\.current\?\.stop\(\)/);
  assert.match(panel,/loadAuthorizedFriendMap/);
  assert.match(panel,/readPeer:peerUid=>transport\.read\(peerUid\)/);
  assert.match(ios,/M2FriendLocationPanel/);
  assert.doesNotMatch(poller,/watchPositionAsync|startLocationUpdatesAsync|TaskManager|AsyncStorage|setDoc\(|addDoc\(|fetch\(/);
  assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND,undefined);
});
