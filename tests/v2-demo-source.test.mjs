import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoDataSource,DEMO_TICK_MS,DEMO_FALLBACK_POSITION} from '../src/data/demo/demoDataSource.ts';
import {DEMO_FRIENDS,DEMO_ZONES} from '../src/data/demo/demoWorld.ts';

function rig({gps}={}){
  let now=1_800_000_000_000;let handle=null;let fn=null;let cleared=0;let started=0;
  const ports={
    now:()=>now,
    setInterval:(f,ms)=>{assert.equal(ms,DEMO_TICK_MS);fn=f;started++;handle={id:started};return handle;},
    clearInterval:h=>{assert.equal(h,handle);cleared++;handle=null;fn=null;},
    myGps:gps,
  };
  const source=createDemoDataSource(ports);
  const tick=(n=1)=>{for(let i=0;i<n;i++){now+=DEMO_TICK_MS;fn?.();}};
  return {source,tick,state:()=>({handle,cleared,started}),advance:ms=>{now+=ms;},now:()=>now};
}
const lastOf=calls=>calls[calls.length-1];

test('demo never touches the network', async t => {
  const original=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN_IN_DEMO');};
  t.after(()=>{globalThis.fetch=original;});
  const r=rig();
  const points=[];const zones=[];
  r.source.location.subscribeFriendPoints((p,c)=>points.push([p,c]));
  r.source.places.subscribe((z,a)=>zones.push([z,a]));
  r.tick(12);
  await r.source.session.signInPhone('0812345678','secret');
  await r.source.location.startForeground('mint');
  await r.source.location.startBackground('mint',4);
  await r.source.wave('mint');
  await r.source.friends.sendRequest('HM-0001');
  await r.source.places.propose('ton',{lat:13.72,lng:100.53},300,'ออฟฟิศ');
  await r.source.location.stopAll();
  assert.ok(points.length>0 && zones.length>0);
});

test('8 friends with the exact status mix', () => {
  const r=rig();
  let friends=[];r.source.friends.subscribe(f=>{friends=f;});
  let points=[];r.source.location.subscribeFriendPoints(p=>{points=p;});
  assert.equal(friends.length,8);
  assert.equal(DEMO_FRIENDS.length,8);
  const count=s=>points.filter(p=>p.status===s).length;
  assert.equal(count('LIVE'),4);
  assert.equal(count('STALE'),2);
  assert.equal(count('OFFLINE'),1);
  const off=friends.filter(f=>!f.consentTheirs);
  assert.equal(off.length,1);
  assert.ok(!points.some(p=>p.friendId===off[0].id),'sharing-off friend has no point');
  assert.ok(friends.every(f=>f.initials.length>0 && f.name.length>0));
});

test('LIVE friends move each tick and are stamped now; STALE points keep their age', () => {
  const r=rig();
  const calls=[];r.source.location.subscribeFriendPoints((p,c)=>calls.push({p,c}));
  const first=lastOf(calls).p;
  r.tick();
  const second=lastOf(calls).p;
  assert.equal(lastOf(calls).c,true);
  for(const before of first.filter(p=>p.status==='LIVE')){
    const after=second.find(p=>p.friendId===before.friendId);
    assert.equal(after.capturedAtMs,r.now());
    assert.ok(after.at.lat!==before.at.lat||after.at.lng!==before.at.lng,before.friendId+' moved');
  }
  for(const before of first.filter(p=>p.status==='STALE')){
    const after=second.find(p=>p.friendId===before.friendId);
    assert.equal(after.capturedAtMs,before.capturedAtMs);
    assert.ok(r.now()-after.capturedAtMs>30_000);
  }
});

test('Bam enters the home zone on tick 10 exactly once', () => {
  const r=rig();
  let alerts=[];r.source.places.subscribe((z,a)=>{alerts=a;});
  r.tick(9);
  assert.equal(alerts.length,0);
  r.tick(1);
  assert.equal(alerts.length,1);
  assert.deepEqual({...alerts[0],atMs:0},{zoneId:'home',friendId:'bam',kind:'enter',atMs:0});
  assert.equal(alerts[0].atMs,r.now());
  r.tick(1);
  assert.equal(alerts.length,1);
});

test('demo zones: active home for Bam (200 m) and pending university for Mint (300 m)', () => {
  const r=rig();
  let zones=[];r.source.places.subscribe(z=>{zones=z;});
  assert.equal(DEMO_ZONES.length,2);
  const home=zones.find(z=>z.id==='home');const uni=zones.find(z=>z.id==='uni');
  assert.deepEqual([home.subjectId,home.radiusM,home.state,home.label],['bam',200,'active','บ้าน']);
  assert.deepEqual([uni.subjectId,uni.radiusM,uni.state,uni.label],['mint',300,'pending','มหาวิทยาลัย']);
});

test('my proposals are auto-approved after 3 ticks; decide works on pending zones', async () => {
  const r=rig();
  let zones=[];r.source.places.subscribe(z=>{zones=z;});
  await r.source.places.propose('ton',{lat:13.72,lng:100.53},300,'ออฟฟิศ');
  const created=zones.find(z=>z.label==='ออฟฟิศ');
  assert.equal(created.state,'pending');
  r.tick(3);
  assert.equal(zones.find(z=>z.id===created.id).state,'active');
  await r.source.places.decide('uni',false);
  assert.ok(!zones.some(z=>z.id==='uni'));
});

test('capabilities are all true in demo', async () => {
  assert.deepEqual(await rig().source.capabilities(),
    {phoneLogin:true,geofences:true,backgroundSharing:true,wave:true});
});

test('background sharing uses the exact deadline and ends on its own', async () => {
  const r=rig();
  let sharing=null;r.source.location.subscribeSharing(s=>{sharing=s;});
  r.source.location.subscribeFriendPoints(()=>{});
  const t0=r.now();
  await r.source.location.startBackground('mint',4);
  assert.deepEqual(sharing.background,{withId:'mint',deadlineMs:t0+4*3_600_000});
  await assert.rejects(r.source.location.startBackground('mint',2),/INVALID_BACKGROUND_HOURS/);
  r.advance(4*3_600_000);
  r.tick();
  assert.equal(sharing.background,null);
});

test('I7: stopAll clears my sharing but keeps the demo world moving; dispose stops the timer', async () => {
  const r=rig();
  let sharing=null;r.source.location.subscribeSharing(s=>{sharing=s;});
  let pts=null;r.source.location.subscribeFriendPoints(p=>{pts=p;});
  await r.source.location.startForeground('ton');
  await r.source.location.startBackground('mint',1);
  await r.source.location.stopAll();
  assert.deepEqual({...sharing,lastBackgroundStop:null},{foregroundWith:null,background:null,lastBackgroundStop:null});
  assert.ok(r.state().handle,'simulator still running');
  r.tick();
  assert.equal(pts.find(p=>p.friendId==='mint').capturedAtMs,r.now(),'LIVE pins keep updating');
  r.source.dispose();
  assert.equal(r.state().handle,null);
  assert.equal(r.state().cleared,1);
});

test('I5: demo deadline expiry leaves a stop record', async () => {
  const r=rig();
  let sharing=null;r.source.location.subscribeSharing(s=>{sharing=s;});
  r.source.location.subscribeFriendPoints(()=>{});
  const t0=r.now();
  await r.source.location.startBackground('mint',1);
  r.advance(3_600_000);r.tick();
  assert.equal(sharing.background,null);
  assert.equal(sharing.lastBackgroundStop.reason,'deadline');
  assert.equal(sharing.lastBackgroundStop.atMs,t0+3_600_000);
});

test('my position: device GPS when available, otherwise the Siam fallback', async () => {
  assert.deepEqual(await rig().source.location.myPosition(),DEMO_FALLBACK_POSITION);
  assert.deepEqual(await rig({gps:async()=>null}).source.location.myPosition(),DEMO_FALLBACK_POSITION);
  assert.deepEqual(await rig({gps:async()=>({lat:13.8,lng:100.6})}).source.location.myPosition(),{lat:13.8,lng:100.6});
  assert.deepEqual(DEMO_FALLBACK_POSITION,{lat:13.7462,lng:100.5347});
});

test('friend requests and session work locally', async () => {
  const r=rig();
  let requests=[];let friends=[];
  r.source.friends.subscribe((f,q)=>{friends=f;requests=q;});
  await r.source.friends.sendRequest('HM-7777');
  assert.equal(requests.filter(q=>q.direction==='outgoing').length,1);
  const incoming=requests.find(q=>q.direction==='incoming');
  assert.ok(incoming,'demo starts with one incoming request');
  await r.source.friends.respond(incoming.id,true);
  assert.equal(friends.length,9);
  await assert.rejects(r.source.friends.sendRequest('  '),/INVALID_CODE/);
  assert.ok(r.source.session.current());
  await r.source.session.signOut();
  assert.equal(r.source.session.current(),null);
  await r.source.session.signInGuest();
  assert.ok(r.source.session.current());
  assert.equal(r.source.mode,'demo');
});
