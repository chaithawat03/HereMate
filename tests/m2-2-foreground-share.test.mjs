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

test('M3 delayed native permission completion after silent account switch never starts remote sharing',async()=>{
 let resolvePermission,uid=a,starts=0,stops=0;
 const pending=new Promise(resolve=>{resolvePermission=resolve;});
 const ctrl=createForegroundSharingController({
  ownerUid:()=>uid,isForeground:()=>true,
  askForegroundPermission:()=>pending,
  watchForegroundFix:async()=>({remove(){}}),
  transport:{
   start:async()=>{starts++;return {enabled:true,expiresAtMs:1_800_000_060_000};},
   publish:async()=>({stored:true,expiresAtMs:0}),
   stop:async()=>{stops++;return {enabled:false};}
  },
  now:()=>1_800_000_000_000,schedule:()=>null,cancel:()=>{},onState:()=>{}
 });
 const first=ctrl.start(b,rel());
 await flush();
 assert.equal(ctrl.getState().phase,'starting');
 uid=c; // actual Firebase identity changed before onAuthStateChanged callback
 resolvePermission(true);
 await first;
 assert.equal(ctrl.getState().phase,'off');
 assert.equal(starts,0);
 assert.equal(stops,0,'no server START means no remote STOP is needed');
});
test('M3 rejected native permission after silent background cannot strand the foreground controller',async()=>{
 let rejectPermission,foreground=true,starts=0,stops=0;
 const pending=new Promise((_,reject)=>{rejectPermission=reject;});
 const ctrl=createForegroundSharingController({
  ownerUid:()=>a,isForeground:()=>foreground,
  askForegroundPermission:()=>pending,
  watchForegroundFix:async()=>({remove(){}}),
  transport:{
   start:async()=>{starts++;return {enabled:true,expiresAtMs:1_800_000_060_000};},
   publish:async()=>({stored:true,expiresAtMs:0}),
   stop:async()=>{stops++;return {enabled:false};}
  },
  now:()=>1_800_000_000_000,schedule:()=>null,cancel:()=>{},onState:()=>{}
 });
 const first=ctrl.start(b,rel());
 await flush();
 foreground=false;
 rejectPermission(Error('Android permission request rejected'));
 await first;
 assert.equal(ctrl.getState().phase,'off');
 assert.equal(ctrl.getState().error,null);
 assert.equal(starts,0);assert.equal(stops,0);
});
test('M3 delayed server START after silent account change must revoke possible grant before binding GPS',async()=>{
 let resolveGrant,uid=a,starts=0,stops=0,watches=0;
 const pending=new Promise(resolve=>{resolveGrant=resolve;});
 const ctrl=createForegroundSharingController({
  ownerUid:()=>uid,isForeground:()=>true,
  askForegroundPermission:async()=>true,
  watchForegroundFix:async()=>{watches++;return {remove(){}};},
  transport:{
   start:async()=>{starts++;return pending;},
   publish:async()=>({stored:true,expiresAtMs:0}),
   stop:async()=>{stops++;return {enabled:false};}
  },
  now:()=>1_800_000_000_000,schedule:()=>null,cancel:()=>{},onState:()=>{}
 });
 const first=ctrl.start(b,rel());
 await flush();
 assert.equal(starts,1);
 uid=c; // no JS auth callback yet
 resolveGrant({enabled:true,expiresAtMs:1_800_000_060_000});
 await first;
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(watches,0);
 assert.equal(stops,1,'a potentially committed remote grant requires STOP');
 assert.equal(ctrl.getState().phase,'off');
});
test('M3 late native GPS watch binding after silent foreground loss releases handle and revokes grant',async()=>{
 let resolveWatch,foreground=true,removed=0,stops=0;
 const pending=new Promise(resolve=>{resolveWatch=resolve;});
 const ctrl=createForegroundSharingController({
  ownerUid:()=>a,isForeground:()=>foreground,
  askForegroundPermission:async()=>true,
  watchForegroundFix:()=>pending,
  transport:{
   start:async()=>({enabled:true,expiresAtMs:1_800_000_060_000}),
   publish:async()=>({stored:true,expiresAtMs:0}),
   stop:async()=>{stops++;return {enabled:false};}
  },
  now:()=>1_800_000_000_000,schedule:()=>null,cancel:()=>{},onState:()=>{}
 });
 const first=ctrl.start(b,rel());
 await flush();
 foreground=false;
 resolveWatch({remove:()=>{removed++;}});
 await first;
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(removed,1);
 assert.equal(stops,1);
 assert.equal(ctrl.getState().phase,'off');
});
test('M3 uncertain remote START on background and failed STOP is not mislabeled OFF',async()=>{
 let rejectGrant,foreground=true,stops=0,failStop=true;
 const pending=new Promise((_,reject)=>{rejectGrant=reject;});
 const ctrl=createForegroundSharingController({
  ownerUid:()=>a,isForeground:()=>foreground,
  askForegroundPermission:async()=>true,
  watchForegroundFix:async()=>{throw Error('must not bind GPS');},
  transport:{
   start:()=>pending,
   publish:async()=>({stored:true,expiresAtMs:0}),
   stop:async()=>{stops++;if(failStop)throw Error('network down');return {enabled:false};}
  },
  now:()=>1_800_000_000_000,schedule:()=>null,cancel:()=>{},onState:()=>{}
 });
 const first=ctrl.start(b,rel());
 await flush();
 foreground=false;
 rejectGrant(Error('START response lost after possible commit'));
 await first;
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(stops,1);
 assert.equal(ctrl.getState().phase,'stop-unconfirmed');
 failStop=false;foreground=true;
 await ctrl.retryStop();
 assert.equal(ctrl.getState().phase,'off');
 assert.equal(stops,2);
});
test('Android M3 sharing owner source checks actual Firebase user, not only delayed callback',()=>{
 const panel=read('src/location/M2SharingPanel.tsx');
 assert.match(panel,/ownerUid:\(\)=>auth\.currentUser\?\.uid===account\.current\?account\.current:null/);
});
