import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createM4ForegroundZoneWatch,M4_WATCH_MAX_MS,M4_WATCH_MIN_FIX_INTERVAL_MS
} from '../src/geofences/m4ForegroundZoneWatch.ts';

const SUBJECT='geofencesubjectuid002',OWNER='geofenceowneruid00001';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function rig(override={}){
 let now=1_800_000_000_000,actor=SUBJECT,foreground=true,permission=true;
 let onFix=null,onError=null,removed=0,evalCount=0,watchCount=0;
 const events=[],phases=[],failures=[],timers=[];
 const ports={
   identity:()=>actor,isForeground:()=>foreground,
   requestPermission:async()=>permission,hasPermission:async()=>permission,
   watch:async(fix,error)=>{
     ++watchCount;onFix=fix;onError=error;
     return {remove:()=>{++removed;}};
   },
   evaluate:async()=>{++evalCount;return 'enter';},
   now:()=>now,
   schedule:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},
   cancel:t=>{t.cancelled=true;},
   onPhase:x=>phases.push(x),
   onEvent:x=>events.push(x),
   onFailure:()=>failures.push('error'),
   ...override
 };
 const controller=createM4ForegroundZoneWatch(ports);
 const fix=()=>({latitude:13.75,longitude:100.5,accuracyMeters:12,capturedAtMs:now-100});
 return {controller,events,phases,failures,timers,fix,
   tick:n=>{now+=n;},
   send:()=>{if(!onFix)throw Error('watch not established');onFix(fix());},
   err:()=>onError?.(),
   setActor:x=>{actor=x;},setForeground:x=>{foreground=x;},
   setPermission:x=>{permission=x;},
   stats:()=>({removed,evalCount,watchCount})
 };
}
test('M4 requires an explicit foreground 2-party-approved start and 60s expiry',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,false),false);
 assert.equal(await x.controller.start(SUBJECT,true),false);
 assert.equal(x.stats().watchCount,0);
 assert.equal(await x.controller.start(OWNER,true),true);
 assert.equal(x.controller.getPhase(),'watching');
 assert.equal(x.timers.length,1);
 assert.equal(x.timers[0].ms,M4_WATCH_MAX_MS);
 x.send();await flush();
 assert.deepEqual(x.events,['enter']);
 assert.equal(x.stats().evalCount,1);
 x.tick(M4_WATCH_MIN_FIX_INTERVAL_MS-1000);
 x.send();await flush();
 assert.equal(x.stats().evalCount,1);
 x.tick(1000);
 x.send();await flush();
 assert.equal(x.stats().evalCount,2);
 x.timers[0].fn();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 x.send();await flush();
 assert.equal(x.stats().evalCount,2);
 assert.equal(x.timers[0].cancelled,true);
 assert.equal(x.failures.length,0);
});
test('M4 stops on permission revocation, account change and background',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 x.setPermission(false);
 x.send();await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().evalCount,0);
 assert.deepEqual(x.failures,['error']);
 x.setPermission(true);
 assert.equal(await x.controller.start(OWNER,true),true);
 x.setActor('anotherSubjectUid00002');
 x.send();await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().evalCount,0);
 x.setActor(SUBJECT);
 assert.equal(await x.controller.start(OWNER,true),true);
 x.setForeground(false);
 x.send();await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().evalCount,0);
});
test('M4 suppresses in-flight events on revoked authorization and in-flight start cancellation',async()=>{
 let finish;
 const pending=new Promise(resolve=>{finish=resolve;});
 const x=rig({evaluate:()=>pending});
 assert.equal(await x.controller.start(OWNER,true),true);
 x.send();await flush();
 x.setPermission(false);
 finish('enter');await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.deepEqual(x.events,[]);
 const y=rig({requestPermission:()=>new Promise(resolve=>{finish=resolve;})});
 const begun=y.controller.start(OWNER,true);
 assert.equal(y.controller.getPhase(),'starting');
 y.controller.stop();
 finish(true);
 assert.equal(await begun,false);
 assert.equal(y.stats().watchCount,0);
 assert.equal(y.controller.getPhase(),'off');
});
test('M4 watcher errors fail closed; no background services or GPS history',async()=>{
 const x=rig();
 await x.controller.start(OWNER,true);
 x.err();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.failures.length,1);
 x.controller.dispose();
 assert.equal(await x.controller.start(OWNER,true),false);
 const source=readFileSync(new URL('../src/geofences/m4ForegroundZoneWatch.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/TaskManager|startLocationUpdatesAsync|AsyncStorage|setDoc\(|addDoc\(|expo-notifications/);
});
