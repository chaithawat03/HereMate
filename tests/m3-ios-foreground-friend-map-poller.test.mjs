import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createForegroundFriendMapPoller,ANDROID_FRIEND_MAP_POLL_MS,
  ANDROID_FRIEND_MAP_READ_LIMIT_PER_TICK,ANDROID_FRIEND_MAP_MAX_READS_PER_60S
} from '../src/location/androidFriendMapPoller.ts';
import {loadAuthorizedFriendMap} from '../src/location/accountScopedFriendMapRead.ts';
import {authorizedPeers} from '../src/location/m2FriendLocationView.ts';

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

test('iOS activation callback can dispose synchronously without installing a map timer',async()=>{
  let controller,reads=0,timers=0;
  const x=rig({
    scheduleInterval:()=>{timers++;return {id:1};},
    refresh:async()=>{reads++;},
    onActive:active=>{if(active)controller.dispose();}
  });
  controller=x.controller;
  assert.equal(controller.start(),false);
  assert.equal(controller.isActive(),false);
  assert.equal(controller.start(),false);
  await flush();
  assert.equal(timers,0);
  assert.equal(reads,0);
});

test('iOS old-account activation cannot overwrite a replacement opt-in timer',async()=>{
  let controller,uid=A,reads=0;
  const timers=[];
  const x=rig({
    currentUid:()=>uid,
    scheduleInterval:fn=>{const h={fn,cancelled:false};timers.push(h);return h;},
    cancelInterval:h=>{h.cancelled=true;},
    refresh:async()=>{reads++;},
    onActive:active=>{
      if(active&&uid===A){
        controller.stop();
        uid=B;
        assert.equal(controller.start(),true);
      }
    }
  });
  controller=x.controller;
  assert.equal(controller.start(),false);
  await flush();
  assert.equal(controller.isActive(),true);
  assert.equal(timers.length,1);
  assert.equal(timers[0].cancelled,false);
  assert.equal(reads,1,'only the replacement account may read');
  controller.stop();
  assert.equal(timers[0].cancelled,true);
});

test('iOS synchronous STOP during timer bind cancels the late native handle',async()=>{
  let controller,reads=0,cancelled=0,returned;
  const x=rig({
    scheduleInterval:fn=>{returned={fn};controller.stop();return returned;},
    cancelInterval:h=>{assert.equal(h,returned);cancelled++;},
    refresh:async()=>{reads++;},
    onActive:()=>{}
  });
  controller=x.controller;
  assert.equal(controller.start(),false);
  assert.equal(controller.isActive(),false);
  assert.equal(cancelled,1);
  returned.fn();await flush();
  assert.equal(reads,0);
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

test('viewer Stop retires an in-flight friend-map read and external Maps handoff',async()=>{
  let epoch=0,resolveRead,readStarted=0;
  const pending=new Promise(resolve=>{resolveRead=resolve;});
  const outcomes=[];
  const x=rig({refresh:async()=>{
    const run=epoch;
    const result=await loadAuthorizedFriendMap({
      viewerUid:A,isCurrent:()=>run===epoch,
      loadRelations:async()=>[{
        id:'friend-relation',senderUid:A,recipientUid:B,
        senderDisplayName:'Viewer',recipientDisplayName:'Friend',
        status:'accepted',senderConsent:true,recipientConsent:true
      }],
      selectPeers:authorizedPeers,
      readPeer:async()=>{readStarted++;return pending;}
    });
    outcomes.push(result);
  }});
  assert.equal(x.controller.start(),true);
  await flush();
  assert.equal(readStarted,1,'authorized HTTPS read started before Stop');
  // The mounted panel's Stop handler invokes clear(), incrementing epoch.
  x.controller.stop();epoch++;
  resolveRead({point:{latitude:13,longitude:100,accuracyMeters:20,
    capturedAtMs:1_800_000_000_000},expiresAtMs:1_800_000_020_000});
  await flush();
  assert.deepEqual(outcomes,[null],'late private result cannot repopulate map');
  const panel=readFileSync(new URL('../src/location/M2FriendLocationPanel.tsx',import.meta.url),'utf8');
  assert.ok(panel.includes('if(autoRefreshing){'));
  assert.ok(panel.includes('}else poller.current?.start();'));
  assert.ok(panel.includes('const viewerUid=session.current,requestEpoch=epoch.current;'));
  assert.equal(panel.split('epoch.current!==requestEpoch').length-1,2,
    'external Maps confirmation and late HTTPS response must both be fenced');
  assert.ok(panel.includes('const clear=useCallback'));
  assert.ok(panel.includes('++epoch.current'));
});

test('viewer transport replacement invalidates pending reads, Maps handoff and visible opt-in',async()=>{
  // dispose() intentionally suppresses onActive(false), so the panel must
  // clear both UI state and the read epoch on a transport prop replacement.
  let epoch=0,resolveRead,readStarted=0;
  const pending=new Promise(resolve=>{resolveRead=resolve;});
  const outcomes=[];
  const x=rig({refresh:async()=>{
    const run=epoch;
    const snapshot=await loadAuthorizedFriendMap({
      viewerUid:A,isCurrent:()=>run===epoch,
      loadRelations:async()=>[{
        id:'friend-relation',senderUid:A,recipientUid:B,
        senderDisplayName:'Viewer',recipientDisplayName:'Friend',
        status:'accepted',senderConsent:true,recipientConsent:true
      }],
      selectPeers:authorizedPeers,
      readPeer:async()=>{readStarted++;return pending;}
    });
    outcomes.push(snapshot);
  }});
  assert.equal(x.controller.start(),true);
  await flush();
  assert.equal(readStarted,1);
  assert.deepEqual(x.events,[true]);
  const oldTick=x.intervals[0].fn;
  x.controller.dispose();
  assert.deepEqual(x.events,[true],
    'controller dispose alone cannot reset React autoRefreshing');
  // The mounted panel cleanup calls clear(), retiring the old epoch.
  epoch++;
  resolveRead({point:{latitude:13,longitude:100,accuracyMeters:20,
    capturedAtMs:1_800_000_000_000},expiresAtMs:1_800_000_020_000});
  await flush();
  assert.deepEqual(outcomes,[null],
    'old transport cannot repaint private pins after replacement');
  oldTick();await flush();
  assert.equal(readStarted,1,'old timer cannot resume private reads');

  const panel=readFileSync(new URL('../src/location/M2FriendLocationPanel.tsx',import.meta.url),'utf8');
  assert.match(panel,/if\(!backendReviewedAndEnabled\|\|\s*!\['android','ios'\]\.includes\(Platform\.OS\)\)\{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*setAutoRefreshing\(false\)/);
  assert.match(panel,/controller\.dispose\(\);[\s\S]*?if\(poller\.current===controller\)\{[\s\S]*?poller\.current=null;[\s\S]*?clear\(\);\s*if\(alive\.current\)setAutoRefreshing\(false\)/);
  assert.match(panel,/\},\[backendReviewedAndEnabled,refresh,clear\]\)/);
  assert.ok(panel.includes('const viewerUid=session.current,requestEpoch=epoch.current;'),
    'pending external Maps confirmation must share the retired epoch');
  const replacement=rig();
  assert.equal(replacement.controller.isActive(),false,
    'replacement transport cannot inherit old viewer opt-in');
  assert.equal(replacement.reads(),0);
});
