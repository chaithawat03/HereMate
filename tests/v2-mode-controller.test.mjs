import test from 'node:test';
import assert from 'node:assert/strict';
import {createModeController,MODE_STOP_TIMEOUT_MS} from '../src/data/modeController.ts';

function fakeSource(mode,{signedIn=true,stopAll}={}){
  const log=[];
  return {
    mode,log,
    session:{current:()=>signedIn?{uid:'u_'+mode,displayName:mode}:null},
    location:{stopAll:stopAll??(async()=>{log.push('stopAll');})},
  };
}
function rig({saved=null,live=fakeSource('live'),demo=fakeSource('demo'),timers}={}){
  const saves=[];let made={demo:0,live:0};
  const c=createModeController({
    makeDemo:()=>{made.demo++;return demo;},
    makeLive:()=>{made.live++;return live;},
    load:async()=>saved,save:async m=>{saves.push(m);},
    ...(timers?{setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout}:{}),
  });
  return {c,saves,made,live,demo};
}

test('init restores the saved mode, defaulting to demo', async () => {
  assert.equal(MODE_STOP_TIMEOUT_MS,5000);
  const a=rig();assert.equal(await a.c.init(),'demo');assert.equal(a.c.active(),a.demo);
  const b=rig({saved:'live'});assert.equal(await b.c.init(),'live');assert.equal(b.c.active(),b.live);
});

test('switch_stops_background_first: stopAll on the old source completes before subscribers see the new one', async () => {
  const order=[];
  let release;
  const live=fakeSource('live',{stopAll:()=>new Promise(r=>{order.push('stop-start');release=()=>{order.push('stop-done');r();};})});
  const {c,demo,saves}=rig({saved:'live',live});
  await c.init();
  c.subscribe(s=>order.push('subscriber:'+s.mode));
  const pending=c.switchTo('demo');
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(order,['stop-start']);
  assert.equal(c.active(),live,'old source stays active until stop finishes');
  release();
  const result=await pending;
  assert.deepEqual(order,['stop-start','stop-done','subscriber:demo']);
  assert.deepEqual(result,{mode:'demo',needsSignIn:false,stopTimedOut:false});
  assert.equal(c.active(),demo);
  assert.deepEqual(saves,['demo']);
});

test('a hung stopAll still swaps after 5 s and reports stopTimedOut', async () => {
  let fire=null;
  const timers={setTimeout:(fn,ms)=>{assert.equal(ms,5000);fire=fn;return 1;},clearTimeout:()=>{}};
  const live=fakeSource('live',{stopAll:()=>new Promise(()=>{})});
  const {c,demo}=rig({saved:'live',live,timers});
  await c.init();
  const pending=c.switchTo('demo');
  await new Promise(r=>setImmediate(r));
  fire();
  assert.deepEqual(await pending,{mode:'demo',needsSignIn:false,stopTimedOut:true});
  assert.equal(c.active(),demo);
});

test('a throwing stopAll still swaps (fail-safe) and reports it', async () => {
  const live=fakeSource('live',{stopAll:async()=>{throw Error('offline');}});
  const {c,demo}=rig({saved:'live',live});
  await c.init();
  assert.deepEqual(await c.switchTo('demo'),{mode:'demo',needsSignIn:false,stopTimedOut:true});
  assert.equal(c.active(),demo);
});

test('switching to live without a session asks for sign-in', async () => {
  const {c}=rig({live:fakeSource('live',{signedIn:false})});
  await c.init();
  assert.deepEqual(await c.switchTo('live'),{mode:'live',needsSignIn:true,stopTimedOut:false});
  assert.equal(c.active().mode,'live');
});

test('switching to the current mode is a no-op', async () => {
  const {c,demo,saves}=rig();
  await c.init();
  assert.deepEqual(await c.switchTo('demo'),{mode:'demo',needsSignIn:false,stopTimedOut:false});
  assert.deepEqual(demo.log,[]);
  assert.deepEqual(saves,[]);
});

test('each switch creates a fresh source (a stopped source is never reused)', async () => {
  const {c,made}=rig();
  await c.init();
  await c.switchTo('live');await c.switchTo('demo');
  assert.deepEqual(made,{demo:2,live:1});
});

test('concurrent switches are serialised', async () => {
  const {c}=rig();
  await c.init();
  const [a,b]=await Promise.all([c.switchTo('live'),c.switchTo('demo')]);
  assert.equal(a.mode,'live');assert.equal(b.mode,'demo');
  assert.equal(c.active().mode,'demo');
});
