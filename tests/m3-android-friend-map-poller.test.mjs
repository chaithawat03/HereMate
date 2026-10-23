import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createAndroidFriendMapPoller,ANDROID_FRIEND_MAP_POLL_MS,
 ANDROID_FRIEND_MAP_READ_LIMIT_PER_TICK,ANDROID_FRIEND_MAP_MAX_READS_PER_60S
} from '../src/location/androidFriendMapPoller.ts';

const USER='androidvieweruid00001';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function rig(extra={}){
 let uid=USER,foreground=true,android=true,reads=0,cancelled=0;
 let now=1_800_000_000_000;
 const intervals=[],states=[];
 const controller=createAndroidFriendMapPoller({
   isAndroid:()=>android,isForeground:()=>foreground,currentUid:()=>uid,
   now:()=>now,
   scheduleInterval:(fn,ms)=>{
     const row={fn,ms,cancelled:false};
     intervals.push(row);return row;
   },
   cancelInterval:row=>{row.cancelled=true;cancelled++;},
   refresh:async()=>{reads++;},
   onActive:x=>states.push(x),
   ...extra
 });
 return {controller,intervals,states,stats:()=>({reads,cancelled}),
   setUid:x=>{uid=x;},setAndroid:x=>{android=x;},
   setForeground:x=>{foreground=x;},advance:ms=>{now+=ms;},
   tick:()=>intervals.at(-1).fn()};
}
test('Android only; explicit tap starts bounded 30 second authenticated reads',async()=>{
 const x=rig();
 assert.equal(ANDROID_FRIEND_MAP_READ_LIMIT_PER_TICK,8);
 assert.equal(ANDROID_FRIEND_MAP_POLL_MS,30000);
 assert.ok(ANDROID_FRIEND_MAP_MAX_READS_PER_60S<=30);
 assert.equal(x.stats().reads,0);
 assert.equal(x.controller.isActive(),false);
 assert.equal(x.controller.start(),true);
 await flush();
 assert.deepEqual(x.states,[true]);
 assert.equal(x.intervals.length,1);
 assert.equal(x.intervals[0].ms,ANDROID_FRIEND_MAP_POLL_MS);
 assert.equal(x.stats().reads,1);
 x.advance(ANDROID_FRIEND_MAP_POLL_MS);
 x.tick();await flush();
 assert.equal(x.stats().reads,2);
 assert.equal(x.controller.start(),false);
 x.controller.stop();
 assert.deepEqual(x.states,[true,false]);
 assert.equal(x.stats().cancelled,1);
 x.tick();await flush(); // already-cancelled callback can never refresh
 assert.equal(x.stats().reads,2);
});
test('foreground, device, valid identity and account switch all fail closed',async()=>{
 const x=rig();
 x.setAndroid(false);
 assert.equal(x.controller.start(),false);
 x.setAndroid(true);x.setForeground(false);
 assert.equal(x.controller.start(),false);
 x.setForeground(true);x.setUid(null);
 assert.equal(x.controller.start(),false);
 x.setUid(USER);
 assert.equal(x.controller.start(),true);
 await flush();
 x.setUid('anotherdeviceuid0003');
 x.tick();await flush();
 assert.equal(x.controller.isActive(),false);
 assert.deepEqual(x.states,[true,false]);
 assert.equal(x.stats().reads,1);
 x.setUid(USER);
 assert.equal(x.controller.start(),true);
 x.setForeground(false);
 x.tick();await flush();
 assert.equal(x.controller.isActive(),false);
 assert.equal(x.stats().reads,2); // second explicit start read only
});
test('rolling minute cap survives explicit stop/start and resets on account change',async()=>{
 const x=rig();
 x.controller.start();await flush();
 x.controller.stop();
 x.controller.start();await flush();
 assert.equal(x.stats().reads,2);
 x.controller.stop();
 x.controller.start();await flush();
 assert.equal(x.stats().reads,2,'rapid restarts cannot exceed 16 reads/min');
 x.advance(60_001);
 x.tick();await flush();
 assert.equal(x.stats().reads,3);
 x.controller.stop();
 x.setUid('separatesignedinuid003');
 x.controller.start();await flush();
 assert.equal(x.stats().reads,4,'new account has its own budget');
});
test('overlapping HTTP batches cannot accumulate; disposal does not restart polling',async()=>{
 let resume;
 const pending=new Promise(resolve=>{resume=resolve;});
 let runs=0;
 const x=rig({refresh:async()=>{runs++;await pending;}});
 x.controller.start();
 await flush();
 x.tick();x.tick();await flush();
 assert.equal(runs,1);
 x.controller.stop();
 resume();await flush();
 x.tick();await flush();
 assert.equal(runs,1);
 x.controller.dispose();
 assert.equal(x.controller.start(),false);
});
test('Android panel never polls automatically, iPhone path remains deferred and no GPS publishing',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const panel=read('src/location/M2FriendLocationPanel.tsx');
 const scoped=read('src/location/accountScopedFriendMapRead.ts');
 const control=read('src/location/androidFriendMapPoller.ts');
 const eas=read('eas.json');
 assert.match(panel,/Platform\.OS==='android'/);
 assert.match(panel,/poller\.current\?\.start\(\)/);
 assert.match(panel,/poller\.current\?\.stop\(\)/);
 assert.match(panel,/AppState\.addEventListener/);
 assert.match(panel,/onAuthStateChanged/);
 assert.match(panel,/loadAuthorizedFriendMap/);
 assert.match(panel,/selectPeers:authorizedPeers/);
 assert.match(scoped,/MAX_MAP_FRIEND_READS/);
 assert.doesNotMatch(control,/watchPositionAsync|startLocationUpdatesAsync|TaskManager|AsyncStorage|setDoc\(|addDoc\(|fetch\(/);
 assert.doesNotMatch(eas,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS/);
});

test('old-account pending refresh cannot starve a newly opted-in account or unlock its batch',async()=>{
 const resolvers=[];
 let calls=0;
 const x=rig({refresh:()=>{calls++;return new Promise(resolve=>resolvers.push(resolve));}});
 x.controller.start();await flush();
 assert.equal(calls,1);
 const stale=x.intervals[0].fn;
 x.controller.stop();
 x.setUid('secondaccountuid0002');
 assert.equal(x.controller.start(),true);
 await flush();
 assert.equal(calls,2,'new account must refresh even when old request is still pending');
 stale();await flush();
 assert.equal(calls,2,'canceled old timer cannot trigger the new session');
 resolvers[0]();await flush();
 x.advance(ANDROID_FRIEND_MAP_POLL_MS);
 x.tick();await flush();
 assert.equal(calls,2,'old completion cannot clear the new in-flight lock');
 resolvers[1]();await flush();
 x.tick();await flush();
 assert.equal(calls,3,'new session can refresh after its own request settles');
 resolvers[2]();await flush();
 x.controller.stop();
});
test('canceled interval cannot spend new account read budget after stop/restart',async()=>{
 let reads=0;
 const x=rig({refresh:async()=>{reads++;}});
 x.controller.start();await flush();
 const oldTimer=x.intervals[0].fn;
 x.controller.stop();
 x.setUid('secondaccountuid0002');
 x.controller.start();await flush();
 assert.equal(reads,2);
 x.advance(ANDROID_FRIEND_MAP_POLL_MS);
 oldTimer();await flush();
 assert.equal(reads,2);
 x.tick();await flush();
 assert.equal(reads,3);
});
test('A-B-A rapid account switch cannot reset account A rolling minute quota',async()=>{
 let reads=0;
 const x=rig({refresh:async()=>{reads++;}});
 x.controller.start();await flush(); // A: 1
 x.controller.stop();x.controller.start();await flush(); // A: 2
 x.controller.stop();x.setUid('secondaccountuid0002');
 x.controller.start();await flush(); // B: 1
 x.controller.stop();x.setUid(USER);
 x.controller.start();await flush(); // A: capped
 assert.equal(reads,3);
 x.advance(60_001);
 x.tick();await flush();
 assert.equal(reads,4,'A can read after the original minute window expires');
});
