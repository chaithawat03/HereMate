import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateM4OneShotForegroundFix} from '../src/geofences/m4OneShotForegroundFix.ts';

const sample=()=>({latitude:13.7,longitude:100.5,
  accuracyMeters:12,capturedAtMs:Date.now()});
const deferred=()=>{
  let resolve;
  const promise=new Promise(r=>{resolve=r;});
  return {promise,resolve};
};
function harness(){
  let uid='subjectuid0000000001',foreground=true,permission=true;
  let calls=0,reads=0;
  const ports={
    isCurrent:()=>uid==='subjectuid0000000001'&&foreground,
    servicesEnabled:async()=>true,
    requestPermission:async()=>true,
    hasPermission:async()=>{reads++;return permission;},
    getCurrentFix:async()=>sample(),
    evaluate:async()=>{calls++;return 'enter';},
    now:Date.now,
    monotonicNow:()=>performance.now()
  };
  return {ports,counts:()=>({calls,reads}),
    switchAccount:()=>{uid='otheraccount00000002';},
    background:()=>{foreground=false;},
    revokePermission:()=>{permission=false;}
  };
}
test('M4 one-shot success requires current actor and OS permission on both sides of HTTPS',async()=>{
  const h=harness();
  assert.equal(await evaluateM4OneShotForegroundFix(h.ports),'enter');
  assert.deepEqual(h.counts(),{calls:1,reads:2});
});
test('late native GPS fix from signed-out/changed Firebase account is never transmitted',async()=>{
  const h=harness(),started=deferred(),gps=deferred();
  h.ports.getCurrentFix=()=>{started.resolve();return gps.promise;};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  h.switchAccount();
  gps.resolve(sample());
  await assert.rejects(work,/M4_ONE_SHOT_CANCELLED/);
  assert.equal(h.counts().calls,0);
});
test('foreground loss during native permission prompt stops before requesting GPS',async()=>{
  const h=harness(),started=deferred(),grant=deferred();
  let gpsCalls=0;
  h.ports.requestPermission=()=>{started.resolve();return grant.promise;};
  h.ports.getCurrentFix=async()=>{gpsCalls++;return sample();};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  h.background();
  grant.resolve(true);
  await assert.rejects(work,/M4_ONE_SHOT_CANCELLED/);
  assert.equal(gpsCalls,0);
});
test('revoked Android foreground permission after GPS prevents HTTP evaluation',async()=>{
  const h=harness(),started=deferred(),gps=deferred();
  h.ports.getCurrentFix=()=>{started.resolve();return gps.promise;};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  h.revokePermission();
  gps.resolve(sample());
  await assert.rejects(work,/M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(h.counts().calls,0);
});
test('identity change while async OS permission recheck resolves cannot transmit fix',async()=>{
  const h=harness(),started=deferred(),permission=deferred();
  h.ports.hasPermission=()=>{started.resolve();return permission.promise;};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  h.switchAccount();
  permission.resolve(true);
  await assert.rejects(work,/M4_ONE_SHOT_CANCELLED/);
  assert.equal(h.counts().calls,0);
});
test('cancelled request during HTTPS result cannot display an old account event',async()=>{
  const h=harness(),started=deferred(),response=deferred();
  h.ports.evaluate=()=>{started.resolve();return response.promise;};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  h.switchAccount();
  response.resolve('enter');
  await assert.rejects(work,/M4_ONE_SHOT_CANCELLED/);
});
test('permission revoked while HTTPS pending suppresses the returned zone event',async()=>{
  const h=harness(),started=deferred(),response=deferred();
  h.ports.evaluate=()=>{started.resolve();return response.promise;};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  h.revokePermission();
  response.resolve('exit');
  await assert.rejects(work,/M4_ONE_SHOT_UNAVAILABLE/);
});
test('stale or low-quality GPS fix is rejected before sending private coordinates',async()=>{
  // Construct each invalid fix AFTER the explicit tap so these cases
  // exercise quality/freshness checks independently of pre-consent rejection.
  for(const makeFix of [
    ()=>({...sample(),capturedAtMs:Date.now()-90_000}),
    ()=>({...sample(),accuracyMeters:150}),
    ()=>({...sample(),latitude:Infinity})
  ]){
    const h=harness();
    h.ports.getCurrentFix=async()=>makeFix();
    await assert.rejects(evaluateM4OneShotForegroundFix(h.ports),
      /M4_ONE_SHOT_UNAVAILABLE/);
    assert.equal(h.counts().calls,0);
  }
});
test('M4 one-shot UI uses generation-bound actor and does not retain stale review decisions',()=>{
  const source=readFileSync(new URL('../src/geofences/M4GeofencePanel.tsx',import.meta.url),'utf8');
  assert.match(source,/evaluateM4OneShotForegroundFix\(/);
  assert.match(source,/isCurrent,\s*servicesEnabled:/);
  assert.match(source,/run\(isCurrent=>checkCurrentLocation\(peer\.uid,isCurrent\)\)/);
  assert.match(source,/evaluate:async fix=>\(await transport\.evaluate\(ownerUid,fix\)\)\.event/);
  assert.match(source,/if\(isCurrent\(\)\)setReviewed\(null\)/);
  assert.doesNotMatch(source,/startLocationUpdatesAsync|TaskManager|AsyncStorage|scheduleNotificationAsync/);
});

test('M4 one-shot never sends a fresh cached fix captured before explicit consent',async()=>{
  const h=harness(),tap=1_800_000_000_000;
  h.ports.now=()=>tap;
  h.ports.getCurrentFix=async()=>({
    latitude:13.7,longitude:100.5,accuracyMeters:12,
    capturedAtMs:tap-500 // within 30s freshness, but before the opt-in
  });
  await assert.rejects(evaluateM4OneShotForegroundFix(h.ports),
    /M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(h.counts().calls,0,'pre-consent private coordinates must not reach HTTPS');
});

test('M4 one-shot accepts an accurate fix captured after the tap, not before',async()=>{
  const h=harness(),tap=1_800_000_000_000;
  let clock=tap;
  h.ports.now=()=>clock;
  h.ports.getCurrentFix=async()=>{
    clock=tap+1500;
    return {latitude:13.7,longitude:100.5,accuracyMeters:12,
      capturedAtMs:tap+1000};
  };
  assert.equal(await evaluateM4OneShotForegroundFix(h.ports),'enter');
  assert.equal(h.counts().calls,1);
});

test('M4 one-shot fails closed on invalid initial clock before prompting for GPS',async()=>{
  const h=harness();
  let prompts=0;
  h.ports.now=()=>NaN;
  h.ports.requestPermission=async()=>{prompts++;return true;};
  await assert.rejects(evaluateM4OneShotForegroundFix(h.ports),
    /M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(prompts,0);
  assert.equal(h.counts().calls,0);
});

test('M4 one-shot rejects late native GPS after 60s despite freshly captured coordinates',async()=>{
  const h=harness(),started=deferred(),gps=deferred();
  const tap=1_800_000_000_000;
  let wall=tap,mono=2000;
  h.ports.now=()=>wall;
  h.ports.monotonicNow=()=>mono;
  h.ports.getCurrentFix=()=>{started.resolve();return gps.promise;};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  wall+=61_000;mono+=61_000;
  gps.resolve({latitude:13.7,longitude:100.5,accuracyMeters:12,capturedAtMs:wall});
  await assert.rejects(work,/M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(h.counts().calls,0,'a late fresh fix cannot extend expired consent');
});

test('M4 one-shot expires during delayed native permission prompt before GPS access',async()=>{
  const h=harness(),started=deferred(),grant=deferred();
  let gpsCalls=0;
  let wall=1_800_000_000_000,mono=1000;
  h.ports.now=()=>wall;h.ports.monotonicNow=()=>mono;
  h.ports.requestPermission=()=>{started.resolve();return grant.promise;};
  h.ports.getCurrentFix=async()=>{gpsCalls++;return sample();};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  wall+=60_000;mono+=60_000;
  grant.resolve(true);
  await assert.rejects(work,/M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(gpsCalls,0,'expired consent must not invoke native GPS');
  assert.equal(h.counts().calls,0);
});

test('M4 one-shot rejects wall-clock rollback while native GPS is pending',async()=>{
  const h=harness(),tap=1_800_000_000_000;
  let wall=tap,mono=1000;
  h.ports.now=()=>wall;h.ports.monotonicNow=()=>mono;
  h.ports.getCurrentFix=async()=>{
    wall=tap-1000;mono+=1000;
    return {latitude:13.7,longitude:100.5,accuracyMeters:12,capturedAtMs:tap};
  };
  await assert.rejects(evaluateM4OneShotForegroundFix(h.ports),
    /M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(h.counts().calls,0);
});

test('M4 one-shot rejects partial monotonic rollback before private HTTPS',async()=>{
  const h=harness(),tap=1_800_000_000_000;
  let wall=tap,mono=1000;
  h.ports.now=()=>wall;h.ports.monotonicNow=()=>mono;
  h.ports.getCurrentFix=async()=>{
    wall=tap+30_000;mono+=30_000;
    return {latitude:13.7,longitude:100.5,accuracyMeters:12,
      capturedAtMs:wall-1000};
  };
  h.ports.hasPermission=async()=>{mono-=10_000;return true;};
  await assert.rejects(evaluateM4OneShotForegroundFix(h.ports),
    /M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(h.counts().calls,0);
});

test('M4 one-shot rejects invalid monotonic clock before OS permission prompt',async()=>{
  const h=harness();
  let services=0,permission=0;
  h.ports.monotonicNow=()=>NaN;
  h.ports.servicesEnabled=async()=>{services++;return true;};
  h.ports.requestPermission=async()=>{permission++;return true;};
  await assert.rejects(evaluateM4OneShotForegroundFix(h.ports),
    /M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(services,0);
  assert.equal(permission,0);
  assert.equal(h.counts().calls,0);
});

test('M4 one-shot UI passes a real monotonic clock, without background location',()=>{
  const source=readFileSync(new URL('../src/geofences/M4GeofencePanel.tsx',import.meta.url),'utf8');
  assert.match(source,/monotonicNow:\(\)=>globalThis\.performance\?\.now\?\.\(\)\?\?NaN/);
  assert.doesNotMatch(source,/startLocationUpdatesAsync|TaskManager|AsyncStorage/);
});

test('M4 one-shot monotonic deadline rejects a delayed fix even if wall time barely advances',async()=>{
  const h=harness(),tap=1_800_000_000_000;
  let wall=tap,mono=1000;
  h.ports.now=()=>wall;h.ports.monotonicNow=()=>mono;
  h.ports.getCurrentFix=async()=>{
    wall=tap+2000;mono+=61_000;
    return {latitude:13.7,longitude:100.5,accuracyMeters:12,
      capturedAtMs:wall-1000};
  };
  await assert.rejects(evaluateM4OneShotForegroundFix(h.ports),
    /M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(h.counts().calls,0);
});

test('M4 one-shot rejects a future-dated GPS fix beyond the original 60s tap window',async()=>{
  const h=harness(),tap=1_800_000_000_000;
  let wall=tap,mono=1000;
  h.ports.now=()=>wall;h.ports.monotonicNow=()=>mono;
  h.ports.getCurrentFix=async()=>{
    wall=tap+59_000;mono+=59_000;
    return {latitude:13.7,longitude:100.5,accuracyMeters:12,
      capturedAtMs:tap+62_000};
  };
  await assert.rejects(evaluateM4OneShotForegroundFix(h.ports),
    /M4_ONE_SHOT_UNAVAILABLE/);
  assert.equal(h.counts().calls,0);
});

test('hung native one-shot GPS is bounded and late fix cannot reach HTTPS',async()=>{
  const h=harness(),started=deferred(),gps=deferred();
  h.ports.deadlineMs=120; // short offline deadline; production stays at 60s
  h.ports.getCurrentFix=()=>{started.resolve();return gps.promise;};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  await assert.rejects(work,/M4_ONE_SHOT_UNAVAILABLE/);
  gps.resolve(sample());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.counts().calls,0,'retired tap cannot publish a late native fix');
});

test('hung OS permission prompt releases one-shot busy path without late GPS',async()=>{
  const h=harness(),started=deferred(),grant=deferred();
  let gpsCalls=0;
  h.ports.deadlineMs=120;
  h.ports.requestPermission=()=>{started.resolve();return grant.promise;};
  h.ports.getCurrentFix=async()=>{gpsCalls++;return sample();};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  await assert.rejects(work,/M4_ONE_SHOT_UNAVAILABLE/);
  grant.resolve(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(gpsCalls,0,'expired consent must not invoke native GPS');
  assert.equal(h.counts().calls,0);
});

test('hung HTTPS evaluation is bounded; late ACK cannot present an event',async()=>{
  const h=harness(),started=deferred(),reply=deferred();
  h.ports.deadlineMs=120;
  h.ports.evaluate=()=>{started.resolve();return reply.promise;};
  const work=evaluateM4OneShotForegroundFix(h.ports);
  await started.promise;
  await assert.rejects(work,/M4_ONE_SHOT_UNAVAILABLE/);
  reply.resolve('enter');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.counts().reads,1,
    'retired HTTPS result cannot run the post-response OS permission/alert path');
});

test('invalid one-shot watchdog bounds fail closed before native permission',async()=>{
  for(const deadlineMs of [0,19,60_001,1.5,NaN]){
    const h=harness();
    let prompts=0;
    h.ports.deadlineMs=deadlineMs;
    h.ports.requestPermission=async()=>{prompts++;return true;};
    await assert.rejects(evaluateM4OneShotForegroundFix(h.ports),
      /M4_ONE_SHOT_UNAVAILABLE/);
    assert.equal(prompts,0);
    assert.equal(h.counts().calls,0);
  }
});
