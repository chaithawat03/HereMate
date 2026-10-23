import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateM4OneShotForegroundFix} from '../src/geofences/m4OneShotForegroundFix.ts';

const sample=()=>({latitude:13.7,longitude:100.5,
  accuracyMeters:12,capturedAtMs:Date.now()-1000});
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
    now:Date.now
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
  for(const fix of [
    {...sample(),capturedAtMs:Date.now()-90_000},
    {...sample(),accuracyMeters:150},
    {...sample(),latitude:Infinity}
  ]){
    const h=harness();
    h.ports.getCurrentFix=async()=>fix;
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
