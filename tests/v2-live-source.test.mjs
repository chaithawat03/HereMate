import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {probeCapabilities,PROBE_TIMEOUT_MS} from '../src/data/live/capabilities.ts';
import {createLiveDataSource} from '../src/data/live/liveDataSource.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ME='viewer_uid_000001',A='friend_uid_00000A',B='friend_uid_00000B',C='friend_uid_00000C';
const BASE='https://example-staging.a.run.app';
let NOW=1_800_000_000_000;
const rel=(peer,patch={})=>({id:ME+'__'+peer,senderUid:ME,recipientUid:peer,senderDisplayName:'Me',
  recipientDisplayName:'P'+peer.slice(-1),status:'accepted',senderConsent:true,recipientConsent:true,...patch});
const fresh=()=>({point:{latitude:13.75,longitude:100.5,accuracyMeters:10,capturedAtMs:NOW-2000},expiresAtMs:NOW+20_000});

function rig(over={}){
  let mapCb=null,mapErr=null,mapStops=0;
  const calls=[];
  let sharingFn=null;
  const ports={
    now:()=>NOW,
    probe:async()=>({phoneLogin:false,geofences:false,backgroundSharing:true,wave:false}),
    auth:{current:()=>({uid:ME,displayName:'Me'}),signInGuest:async()=>calls.push('guest'),
      signInGoogle:async()=>calls.push('google'),signOut:async()=>calls.push('signout')},
    profile:{get:async()=>({displayName:'Me',friendCode:ME}),rename:async n=>calls.push('rename:'+n)},
    friends:{list:async()=>[rel(A),rel(B,{recipientConsent:false}),
        {...rel(C),senderUid:C,recipientUid:ME,senderDisplayName:'PC',status:'pending',id:C+'__'+ME}],
      send:async c=>calls.push('send:'+c),act:async(r,a)=>calls.push('act:'+r.id+':'+a),
      setConsent:async(r,on)=>calls.push('consent:'+r.id+':'+on)},
    map:{start:(onSnapshot,onError)=>{mapCb=onSnapshot;mapErr=onError;return ()=>{mapStops++;};}},
    sharing:{start:async p=>{calls.push('fg:'+p);sharingFn?.(p);},stop:async()=>{calls.push('fg-stop');sharingFn?.(null);},
      subscribe:fn=>{sharingFn=fn;fn(null);return ()=>{sharingFn=null;};}},
    background:{start:async(p,h)=>calls.push('bg:'+p+':'+h),stop:async r=>calls.push('bg-stop:'+r),
      current:()=>null},
    places:null,
    myPosition:async()=>null,
    ...over,
  };
  const source=createLiveDataSource(ports);
  return {source,calls,snapshot:s=>mapCb(s),fail:()=>mapErr(),stops:()=>mapStops};
}

test('probe: 401/403 means deployed, 404/timeout/network error means not', async () => {
  assert.equal(PROBE_TIMEOUT_MS,3000);
  const seen=[];
  const fetchWith=status=>async(url,init)=>{seen.push([url,init.method,init.headers?.authorization]);return {status};};
  const deployed=await probeCapabilities({fetchImpl:fetchWith(401),baseUrl:BASE,timeoutMs:3000});
  assert.deepEqual(deployed,{phoneLogin:false,geofences:true,backgroundSharing:true,wave:false});
  assert.deepEqual(seen.map(s=>s[0]).sort(),[BASE+'/v1/geofences/review',BASE+'/v1/locations/background/start']);
  assert.ok(seen.every(s=>s[1]==='POST'&&s[2]===undefined),'probe never sends a bearer token');
  assert.equal((await probeCapabilities({fetchImpl:fetchWith(403),baseUrl:BASE,timeoutMs:3000})).geofences,true);
  assert.deepEqual(await probeCapabilities({fetchImpl:fetchWith(404),baseUrl:BASE,timeoutMs:3000}),
    {phoneLogin:false,geofences:false,backgroundSharing:false,wave:false});
  assert.equal((await probeCapabilities({fetchImpl:async()=>{throw Error('net');},baseUrl:BASE,timeoutMs:3000})).geofences,false);
  const slow=async(url,init)=>new Promise((res,rej)=>init.signal.addEventListener('abort',()=>rej(Error('aborted'))));
  assert.equal((await probeCapabilities({fetchImpl:slow,baseUrl:BASE,timeoutMs:20})).backgroundSharing,false);
});

test('phone login and wave are not available in Live', async () => {
  const {source}=rig();
  assert.equal(source.mode,'live');
  await assert.rejects(source.session.signInPhone('0812345678','pw'),/NOT_AVAILABLE/);
  await assert.rejects(source.wave(A),/NOT_AVAILABLE/);
});

test('friends: accepted rows become friends, pending become requests', async () => {
  const {source,calls}=rig();
  const got=await new Promise(res=>{const u=source.friends.subscribe((f,q)=>{if(f.length){u();res({f,q});}});});
  assert.deepEqual(got.f.map(f=>[f.id,f.name,f.consentMine,f.consentTheirs]),[[A,'PA',true,true],[B,'PB',true,false]]);
  assert.deepEqual(got.q,[{id:C+'__'+ME,direction:'incoming',name:'PC'}]);
  await source.friends.respond(C+'__'+ME,true);
  await source.friends.setConsent(A,false);
  await source.friends.remove(B);
  assert.deepEqual(calls.filter(c=>c.startsWith('act')||c.startsWith('consent')),
    ['act:'+C+'__'+ME+':accepted','consent:'+ME+'__'+A+':false','act:'+ME+'__'+B+':removed']);
});

test('network_loss_marks_stale: after a poll error, LIVE friends become STALE, lose coordinates, connected=false', () => {
  const r=rig();
  const seen=[];
  r.source.location.subscribeFriendPoints((p,c)=>seen.push({p,c}));
  r.snapshot({viewerUid:ME,relations:[rel(A),rel(B,{recipientConsent:false})],reads:{[A]:fresh()},nowMs:NOW});
  const ok=seen[seen.length-1];
  assert.equal(ok.c,true);
  const a=ok.p.find(p=>p.friendId===A);
  assert.equal(a.status,'LIVE');
  assert.deepEqual(a.at,{lat:13.75,lng:100.5});
  assert.equal(a.capturedAtMs,NOW-2000);
  assert.equal(ok.p.find(p=>p.friendId===B).status,'SHARING_OFF');
  assert.equal(ok.p.find(p=>p.friendId===B).at,null);
  r.fail();
  const lost=seen[seen.length-1];
  assert.equal(lost.c,false);
  const a2=lost.p.find(p=>p.friendId===A);
  assert.equal(a2.status,'STALE');
  assert.equal(a2.at,null);
  assert.equal(a2.capturedAtMs,NOW-2000,'age stays visible');
});

test('expired and unavailable reads never expose coordinates', () => {
  const r=rig();
  let last=null;r.source.location.subscribeFriendPoints(p=>{last=p;});
  const expired={point:{latitude:1,longitude:2,accuracyMeters:5,capturedAtMs:NOW-60_000},expiresAtMs:NOW-1};
  r.snapshot({viewerUid:ME,relations:[rel(A),rel(C)],reads:{[A]:expired},nowMs:NOW});
  const a=last.find(p=>p.friendId===A),c=last.find(p=>p.friendId===C);
  assert.equal(a.status,'STALE');assert.equal(a.at,null);
  assert.equal(c.status,'SHARING_OFF');assert.equal(c.at,null);
});

test('map polling starts with the first subscriber and stops with the last; stopAll stops everything', async () => {
  const r=rig();
  const u1=r.source.location.subscribeFriendPoints(()=>{});
  const u2=r.source.location.subscribeFriendPoints(()=>{});
  u1();assert.equal(r.stops(),0);
  u2();assert.equal(r.stops(),1);
  r.source.location.subscribeFriendPoints(()=>{});
  await r.source.location.stopAll();
  assert.equal(r.stops(),2);
  assert.deepEqual(r.calls.filter(c=>/stop/.test(c)),['bg-stop:mode','fg-stop']);
});

test('background start validates hours and delegates; sharing state reflects foreground + background', async () => {
  let bg=null;
  const r=rig({background:{start:async(p,h)=>{bg={withId:p,deadlineMs:NOW+h*3_600_000};},stop:async()=>{bg=null;},current:()=>bg}});
  let state=null;r.source.location.subscribeSharing(s=>{state=s;});
  await r.source.location.startForeground(A);
  assert.deepEqual(state,{foregroundWith:A,background:null});
  await r.source.location.startBackground(A,8);
  assert.deepEqual(state,{foregroundWith:A,background:{withId:A,deadlineMs:NOW+8*3_600_000}});
  await assert.rejects(r.source.location.startBackground(A,3),/INVALID_BACKGROUND_HOURS/);
  await r.source.location.stopBackground();
  assert.equal(state.background,null);
});

test('places without the geofence capability reject NOT_AVAILABLE and list nothing', async () => {
  const r=rig();
  let zones=null;r.source.places.subscribe(z=>{zones=z;});
  assert.deepEqual(zones,[]);
  await assert.rejects(r.source.places.propose(A,{lat:1,lng:2},200,'x'),/NOT_AVAILABLE/);
});

test('the live source never imports demo code', () => {
  for(const f of ['src/data/live/liveDataSource.ts','src/data/live/capabilities.ts','src/data/live/liveWiring.ts'])
    assert.doesNotMatch(read(f),/data\/demo|demoDataSource|demoWorld/,f);
});
