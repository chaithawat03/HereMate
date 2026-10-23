import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createForegroundSharingController,isEligibleToStart,freshShareFix,
  MAX_SHARE_SESSION_MS,MIN_FIX_INTERVAL_MS
} from '../src/location/m2ForegroundSession.ts';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const a='owner_000000000001',b='friend_00000000002',c='stranger_0000003';
const rel=(patch={})=>({senderUid:a,recipientUid:b,status:'accepted',
  senderConsent:true,recipientConsent:true,...patch});
function rig(){
 let now=1_800_000_000_000,foreground=true,permission=true,uid=a;
 let callback=null,errorCallback=null,removes=0,stops=0,starts=0;
 let publishes=[],timer=null, failStop=false, failWatch=false;
 const states=[],timers=[];
 const transport={
  start:async peer=>{
    starts++;assert.equal(peer,b);
    return {enabled:true,expiresAtMs:now+MAX_SHARE_SESSION_MS};
  },
  publish:async(peer,point)=>{
    publishes.push({peer,point});
    return {stored:true,expiresAtMs:now+20_000};
  },
  stop:async peer=>{
    assert.equal(peer,b);stops++;
    if(failStop)throw Error('network_offline');
    return {enabled:false};
  },
 };
 const control=createForegroundSharingController({
  ownerUid:()=>uid,isForeground:()=>foreground,
  askForegroundPermission:async()=>permission,
  watchForegroundFix:async(fn,onError)=>{
    if(failWatch)throw Error('watch_failed');
    callback=fn;errorCallback=onError;
    return {remove:()=>{removes++;callback=null;}};
  },
  transport,now:()=>now,
  schedule:(fn,ms)=>{timer={fn,ms};timers.push(timer);return timer;},
  cancel:handle=>{if(timer===handle)timer=null;},
  onState:state=>states.push(state)
 });
 return {
  control,states,transport,push:fix=>callback?.(fix),gpsError:()=>errorCallback?.(),
  point:()=>({latitude:13.6,longitude:100.3,accuracyMeters:20,capturedAtMs:now-1000}),
  get publishes(){return publishes;},get stops(){return stops;},get starts(){return starts;},
  get removes(){return removes;},get timer(){return timer;},
  tick:ms=>{now+=ms;},leave:()=>{foreground=false;control.interrupted();},
  setPermission:v=>{permission=v;},setUid:v=>{uid=v;control.accountChanged();},
  silentUidChange:v=>{uid=v;},silentLeave:()=>{foreground=false;},
  failStop:v=>{failStop=v;},failWatch:v=>{failWatch=v;},
 };
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
test('only a selected accepted and mutually consented friend is eligible',()=>{
 assert.equal(isEligibleToStart(rel(),a,b),true);
 assert.equal(isEligibleToStart(rel({status:'pending'}),a,b),false);
 assert.equal(isEligibleToStart(rel({senderConsent:false}),a,b),false);
 assert.equal(isEligibleToStart(rel({recipientConsent:false}),a,b),false);
 assert.equal(isEligibleToStart(rel({recipientUid:c}),a,b),false);
 assert.equal(isEligibleToStart(rel(),a,a),false);
});
test('fix never publishes stale, inaccurate or invalid coordinates',()=>{
 const r=rig();
 assert.equal(freshShareFix(r.point(),1_800_000_000_000),true);
 for(const patch of [{latitude:91},{longitude:-181},{accuracyMeters:201},
  {accuracyMeters:Infinity},{capturedAtMs:1_799_999_960_000}])
  assert.equal(freshShareFix({...r.point(),...patch},1_800_000_000_000),false);
});
test('default OFF and explicit action required, no GPS before mutual consent',async()=>{
 const r=rig();
 assert.equal(r.control.getState().phase,'off');
 await r.control.start(b,rel({senderConsent:false}));
 assert.equal(r.starts,0);assert.equal(r.control.getState().phase,'off');
 assert.equal(r.control.getState().error,'ineligible');
 await r.control.start(b,rel());
 assert.equal(r.starts,1);
 assert.equal(r.control.getState().phase,'sharing');
 assert.equal(r.timer.ms,MAX_SHARE_SESSION_MS);
 assert.equal(r.publishes.length,0);
 r.push(r.point());await flush();
 assert.equal(r.publishes.length,1);
 assert.ok(!Object.hasOwn(r.control.getState(),'latitude')); // Never put GPS into UI state.
 r.tick(MIN_FIX_INTERVAL_MS-1);
 r.push(r.point());await flush();assert.equal(r.publishes.length,1);
 r.tick(1);r.push(r.point());await flush();assert.equal(r.publishes.length,2);
 await r.control.stop();
 assert.equal(r.control.getState().phase,'off');
 assert.equal(r.stops,1);assert.ok(r.removes>0);
});
test('Android denial and background before grant cannot create remote sharing',async()=>{
 const r=rig();r.setPermission(false);
 await r.control.start(b,rel());
 assert.equal(r.control.getState().error,'permission');
 assert.equal(r.starts,0);
 const s=rig();
 let resolve;
 s.control; // pending mock permission from separate port
 const transport=s.transport;
 const pending=createForegroundSharingController({
  ownerUid:()=>a,isForeground:()=>false,
  askForegroundPermission:async()=>true,
  watchForegroundFix:async()=>({remove(){}}),
  transport,now:Date.now,schedule:()=>null,cancel:()=>{},onState:()=>{}
 });
 await pending.start(b,rel());
 assert.equal(s.starts,0);
});
test('background, auth change and consent revoke immediately stop local watcher and request remote stop',async()=>{
 for(const incident of ['background','auth','consent']){
  const r=rig();await r.control.start(b,rel());
  if(incident==='background')r.leave();
  if(incident==='auth')r.setUid(c);
  if(incident==='consent')r.control.consentChanged(rel({recipientConsent:false}));
  await flush();
  assert.equal(r.control.getState().phase,'off');
  assert.equal(r.stops,1);assert.ok(r.removes>=1);
  r.push(r.point());await flush();assert.equal(r.publishes.length,0);
 }
});
test('a delayed auth or AppState callback cannot allow another fix to publish',async()=>{
 for(const incident of ['silent-auth','silent-background']){
  const r=rig();await r.control.start(b,rel());
  if(incident==='silent-auth')r.silentUidChange(c);
  else r.silentLeave();
  r.push(r.point());
  await flush();
  assert.equal(r.publishes.length,0);
  assert.equal(r.stops,1);
  assert.equal(r.control.getState().phase,'off');
 }
});
test('backend STOP failure is not mislabeled as off and retry confirms revocation',async()=>{
 const r=rig();await r.control.start(b,rel());
 r.failStop(true);
 await r.control.stop();
 assert.equal(r.control.getState().phase,'stop-unconfirmed');
 assert.equal(r.control.getState().error,'backend');
 await r.control.start(b,rel());assert.equal(r.starts,1);
 r.failStop(false);
 await r.control.retryStop();
 assert.equal(r.control.getState().phase,'off');
 assert.equal(r.stops,2);
});
test('one-minute expiry stops watcher, revokes and never silently renews',async()=>{
 const r=rig();await r.control.start(b,rel());
 assert.equal(r.starts,1);
 r.tick(MAX_SHARE_SESSION_MS);
 r.timer.fn();
 await flush();
 assert.equal(r.control.getState().phase,'off');
 assert.equal(r.starts,1);
 assert.equal(r.stops,1);
});
test('late grant after a STOP is revoked before any GPS watcher begins',async()=>{
 let resolve;
 let stops=0,watches=0;
 const waiting=new Promise(r=>{resolve=r;});
 const c=createForegroundSharingController({
  ownerUid:()=>a,isForeground:()=>true,
  askForegroundPermission:async()=>true,
  watchForegroundFix:async()=>{watches++;return {remove(){}};},
  transport:{
    start:async()=>waiting,
    publish:async()=>({stored:true,expiresAtMs:0}),
    stop:async()=>{stops++;return {enabled:false};},
  },
  now:()=>1_800_000_000_000,schedule:()=>null,cancel:()=>{},onState:()=>{}
 });
 const starting=c.start(b,rel());
 await flush();
 const stopping=c.stop();
 resolve({enabled:true,expiresAtMs:1_800_000_060_000});
 await Promise.all([starting,stopping]);
 assert.equal(stops,1);assert.equal(watches,0);
 assert.equal(c.getState().phase,'off');
});
test('in-flight publish completion cannot resurrect location after STOP',async()=>{
 let resolve;
 const pending=new Promise(r=>{resolve=r;});
 const r=rig();
 r.transport.publish=async(peer,fix)=>{r.publishes.push({peer,point:fix});return pending;};
 await r.control.start(b,rel());
 r.push(r.point());await flush();
 const stopping=r.control.stop();
 assert.equal(r.stops,0); // backend STOP waits for in-flight publish
 resolve({stored:true,expiresAtMs:1_800_000_020_000});
 await stopping;
 assert.equal(r.stops,1);
 assert.equal(r.control.getState().phase,'off');
});
test('UI scaffold remains unmounted, without a live endpoint, URL or EAS permission',()=>{
 const app=read('App.tsx'),eas=JSON.parse(read('eas.json'));
 const panel=read('src/location/M2SharingPanel.tsx');
 const session=read('src/location/m2ForegroundSession.ts');
 assert.doesNotMatch(app,/M2SharingPanel|EXPO_PUBLIC_ENABLE_M2_SHARING/);
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M2_SHARING,undefined);
 assert.match(panel,/backendReviewedAndEnabled/);
 assert.match(panel,/onAuthStateChanged/);
 assert.match(panel,/AppState\.addEventListener/);
 assert.match(panel,/Location\.requestForegroundPermissionsAsync/);
 assert.match(panel,/Location\.getForegroundPermissionsAsync/);
 assert.match(panel,/Location\.hasServicesEnabledAsync/);
 assert.match(panel,/bindVerifiedForegroundWatch\(/);
 assert.match(panel,/watching=false;subscription\.remove\(\)/);
 assert.match(panel,/t\('m2Unavailable'\)/);
 assert.doesNotMatch(panel+session,/https?:\/\/|fetch\(|getDatabase\(|setDoc\(|backgroundLocation|startLocationUpdatesAsync|requestBackgroundPermissionsAsync/);
});
