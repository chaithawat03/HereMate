import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 createM4ForegroundZoneWatch,M4_WATCH_MAX_MS,M4_WATCH_MIN_FIX_INTERVAL_MS
} from '../src/geofences/m4ForegroundZoneWatch.ts';

const SUBJECT='geofencesubjectuid002',OWNER='geofenceowneruid00001';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function rig(override={}){
 let now=1_800_000_000_000,monotonic=10_000,actor=SUBJECT,foreground=true,permission=true;
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
   now:()=>now,monotonicNow:()=>monotonic,
   schedule:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},
   cancel:t=>{t.cancelled=true;},
   onPhase:x=>phases.push(x),
   onEvent:x=>events.push(x),
   onFailure:()=>failures.push('error'),
   ...override
 };
 const controller=createM4ForegroundZoneWatch(ports);
 const fix=()=>({latitude:13.75,longitude:100.5,accuracyMeters:12,capturedAtMs:now});
 return {controller,events,phases,failures,timers,fix,
   tick:n=>{now+=n;monotonic+=n;},
   rewindWall:n=>{now-=n;},
   jumpWall:n=>{now+=n;},
   rewindMonotonic:n=>{monotonic-=n;},
   send:()=>{if(!onFix)throw Error('watch not established');onFix(fix());},
   sendFix:point=>{if(!onFix)throw Error('watch not established');onFix(point);},
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
test('M4 UI phase adapter throwing during START cannot establish unbounded GPS consent',async()=>{
 const x=rig({onPhase:phase=>{
   if(phase==='starting')throw Error('React view unmounted before consent indicator');
 }});
 assert.equal(await x.controller.start(OWNER,true),false);
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().watchCount,0,'native GPS must never bind');
 assert.equal(x.timers.length,0,'no deadline needed for rejected consent');
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
});

test('M4 UI phase adapter throwing at WATCHING retires the already-bound native GPS',async()=>{
 let removeCount=0;
 const x=rig({
   onPhase:phase=>{
     if(phase==='watching')throw Error('React UI rejected live watch state');
   },
   watch:async()=>({remove:()=>{removeCount++;}})
 });
 assert.equal(await x.controller.start(OWNER,true),false);
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(removeCount,1,'already-bound native GPS must be removed');
 assert.equal(x.timers.length,1);
 assert.equal(x.timers[0].cancelled,true);
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
});

test('M4 UI phase adapter throwing at OFF cannot break STOP or allow stale GPS fixes',async()=>{
 let callback,removed=0;
 const x=rig({
   onPhase:phase=>{
     if(phase==='off')throw Error('React view unmounted during STOP');
   },
   watch:async onFix=>{
     callback=onFix;
     return {remove:()=>{removed++;}};
   }
 });
 assert.equal(await x.controller.start(OWNER,true),true);
 assert.doesNotThrow(()=>x.controller.stop());
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(removed,1);
 callback(x.fix());await flush();
 assert.equal(x.stats().evalCount,0);
 assert.deepEqual(x.events,[]);
 assert.equal(await x.controller.start(OWNER,true),true,
   'fresh explicit opt-in can recover after stale UI callback');
 x.controller.stop();
 assert.equal(removed,2);
});

test('M4 reentrant STARTING UI STOP prevents stale permission prompts and deadline timers',async()=>{
 let controller,permissionCalls=0;
 const x=rig({
   requestPermission:async()=>{permissionCalls++;return true;},
   onPhase:phase=>{if(phase==='starting')controller.stop();}
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),false);
 assert.equal(controller.getPhase(),'off');
 assert.equal(permissionCalls,0,'STOP in UI callback must prevent stale native permission prompt');
 assert.equal(x.timers.length,0,'retired generation must not arm deadline');
 assert.equal(x.stats().watchCount,0);
 assert.deepEqual(x.failures,[]);
});

test('M4 reentrant STARTING STOP and fresh opt-in cannot be canceled by retired start',async()=>{
 let controller,restart=null,once=false,permissionCalls=0;
 const x=rig({
   requestPermission:async()=>{permissionCalls++;return true;},
   onPhase:phase=>{
     if(phase==='starting'&&!once){
       once=true;
       controller.stop();
       restart=controller.start(OWNER,true);
     }
   }
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),false,'old generation must not report success');
 assert.equal(await restart,true,'new explicitly opted-in generation remains live');
 assert.equal(controller.getPhase(),'watching');
 assert.equal(permissionCalls,1,'only new generation may request OS permission');
 assert.equal(x.timers.length,1,'only new generation may arm expiry');
 assert.equal(x.stats().watchCount,1);
 controller.stop();
 assert.equal(x.stats().removed,1);
});

test('M4 reentrant WATCHING UI STOP reports retired start as unsuccessful',async()=>{
 let controller,removed=0;
 const x=rig({
   onPhase:phase=>{if(phase==='watching')controller.stop();},
   watch:async()=>({remove:()=>{removed++;}})
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),false);
 assert.equal(controller.getPhase(),'off');
 assert.equal(removed,1,'native watcher must be released exactly once');
 assert.ok(x.timers.every(t=>t.cancelled));
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
});

test('M4 reentrant WATCHING STOP then new opt-in keeps the new watcher',async()=>{
 let controller,restart=null,once=false,removed=0;
 const x=rig({
   onPhase:phase=>{
     if(phase==='watching'&&!once){
       once=true;
       controller.stop();
       restart=controller.start(OWNER,true);
     }
   },
   watch:async()=>({remove:()=>{removed++;}})
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),false);
 assert.equal(await restart,true);
 assert.equal(controller.getPhase(),'watching');
 assert.equal(removed,1,'old watcher removed; new watcher must survive');
 assert.equal(x.stats().watchCount,0,'custom native watch stub is counted separately');
 assert.equal(x.timers.length,2);
 assert.equal(x.timers[0].cancelled,true);
 assert.equal(x.timers[1].cancelled,false);
 controller.stop();
 assert.equal(removed,2);
});

test('M4 STARTING UI adapter silent identity/background switch cannot prompt for GPS',async()=>{
 for(const transition of ['account','background']){
   let permissionCalls=0,controller;
   const x=rig({
     requestPermission:async()=>{permissionCalls++;return true;},
     onPhase:phase=>{
       if(phase==='starting'){
         if(transition==='account')x.setActor('anotherSubjectUid00002');
         else x.setForeground(false);
       }
     }
   });
   controller=x.controller;
   assert.equal(await controller.start(OWNER,true),false,transition);
   assert.equal(controller.getPhase(),'off',transition);
   assert.equal(permissionCalls,0,transition+' must not prompt for GPS');
   assert.equal(x.timers.length,0,transition+' must not arm stale timer');
   assert.equal(x.stats().watchCount,0);
   assert.deepEqual(x.failures,[]);
 }
});

test('M4 WATCHING UI adapter silent identity/background switch releases bound GPS immediately',async()=>{
 for(const transition of ['account','background']){
   let removed=0;
   const x=rig({
     onPhase:phase=>{
       if(phase==='watching'){
         if(transition==='account')x.setActor('anotherSubjectUid00002');
         else x.setForeground(false);
       }
     },
     watch:async()=>({remove:()=>{removed++;}})
   });
   assert.equal(await x.controller.start(OWNER,true),false,transition);
   assert.equal(x.controller.getPhase(),'off',transition);
   assert.equal(removed,1,'must remove native watcher on '+transition);
   assert.ok(x.timers.every(t=>t.cancelled));
   assert.deepEqual(x.events,[]);
   assert.deepEqual(x.failures,[]);
 }
});

test('M4 throwing initial identity, foreground or clock adapter denies opt-in without native side effects',async()=>{
 for(const failingPort of ['identity','isForeground','now','monotonicNow']){
   let fail=true;
   const normal={
     identity:()=>SUBJECT,isForeground:()=>true,
     now:()=>1_800_000_000_000,monotonicNow:()=>10_000
   };
   const x=rig({[failingPort]:()=>{
     if(fail)throw Error('unavailable native/JS adapter');
     return normal[failingPort]();
   }});
   assert.equal(await x.controller.start(OWNER,true),false,failingPort);
   assert.equal(x.controller.getPhase(),'off',failingPort);
   assert.equal(x.stats().watchCount,0,failingPort);
   assert.equal(x.timers.length,0,failingPort);
   assert.deepEqual(x.failures,[],failingPort);
   fail=false;
   assert.equal(await x.controller.start(OWNER,true),true,
     failingPort+' recovery requires fresh explicit opt-in');
   x.controller.stop();
 }
});

test('M4 throwing identity adapter on native GPS fix immediately retires consent',async()=>{
 let throwIdentity=false;
 const x=rig({identity:()=>{
   if(throwIdentity)throw Error('Firebase identity adapter unavailable');
   return SUBJECT;
 }});
 assert.equal(await x.controller.start(OWNER,true),true);
 throwIdentity=true;
 x.send();await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 assert.equal(x.stats().evalCount,0,'unverified identity cannot send GPS to Staging');
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
});

test('M4 throwing second wall-clock read on native fix cannot leak GPS',async()=>{
 let calls=0,failOn=Infinity;
 const x=rig({now:()=>{
   if(++calls===failOn)throw Error('JS clock adapter unavailable');
   return 1_800_000_000_000;
 }});
 assert.equal(await x.controller.start(OWNER,true),true);
 // First GPS clock read occurs in active(), second in fresh-fix validation.
 failOn=calls+2;
 x.send();await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 assert.equal(x.stats().evalCount,0);
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
});

test('M4 deadline timer still retires native GPS when identity adapter throws',async()=>{
 let throwIdentity=false;
 const x=rig({identity:()=>{
   if(throwIdentity)throw Error('Firebase unavailable during expiry');
   return SUBJECT;
 }});
 assert.equal(await x.controller.start(OWNER,true),true);
 throwIdentity=true;
 assert.doesNotThrow(()=>x.timers[0].fn());
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 assert.ok(x.timers[0].cancelled);
 assert.equal(x.stats().evalCount,0);
 assert.deepEqual(x.failures,[],'unavailable identity cannot receive warning');
});

test('M4 forward device clock jump cannot bypass 10s private geofence rate limit',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 x.send();await flush();
 assert.equal(x.stats().evalCount,1);
 // A manual/NTP forward clock jump makes Date.now appear 20s later,
 // but no real monotonic time has elapsed since the last private request.
 x.jumpWall(20_000);
 x.send();await flush();
 assert.equal(x.stats().evalCount,1,
   'wall-clock jump alone must not trigger a second private evaluate');
 x.tick(M4_WATCH_MIN_FIX_INTERVAL_MS-1);
 x.send();await flush();
 assert.equal(x.stats().evalCount,1,
   'a real monotonic interval shorter than 10s is still throttled');
 x.tick(1);
 x.send();await flush();
 assert.equal(x.stats().evalCount,2,
   'a real 10s monotonic interval permits the next private evaluate');
 x.controller.stop();
});

test('M4 invalid second monotonic sample fails closed before private evaluate',async()=>{
 let calls=0,failAt=Infinity;
 const x=rig({monotonicNow:()=>++calls===failAt?NaN:10_000});
 assert.equal(await x.controller.start(OWNER,true),true);
 // observe() calls active() (two monotonic reads), then samples the
 // throttle clock independently. Fail precisely at that second gate.
 failAt=calls+3;
 x.send();await flush();
 assert.equal(x.stats().evalCount,0);
 assert.deepEqual(x.events,[]);
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 assert.ok(x.timers.every(t=>t.cancelled));
});

test('M4 rejects a recent but pre-consent cached GPS fix before private evaluate',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 const beforeConsent={...x.fix(),capturedAtMs:x.fix().capturedAtMs-500};
 x.sendFix(beforeConsent);
 await flush();
 assert.equal(x.stats().evalCount,0,
   'a 500ms-old cached fix was captured before explicit consent');
 assert.deepEqual(x.events,[]);
 assert.equal(x.controller.getPhase(),'watching',
   'discarding a cached fix must not invalidate valid ongoing consent');
 x.send();await flush();
 assert.equal(x.stats().evalCount,1,'a post-consent GPS fix can be evaluated');
 assert.deepEqual(x.events,['enter']);
 x.controller.stop();
});

test('M4 rejects a future-dated native GPS fix captured outside this 60s opt-in',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 x.tick(M4_WATCH_MAX_MS-1000); // still within consent by JS wall-clock
 const futureFix={...x.fix(),capturedAtMs:x.fix().capturedAtMs+1500};
 x.sendFix(futureFix);await flush();
 assert.equal(x.stats().evalCount,0,
   'native clock skew cannot authorize a fix captured beyond the consent deadline');
 assert.deepEqual(x.events,[]);
 assert.equal(x.controller.getPhase(),'watching',
   'discarded out-of-window fix does not revoke otherwise valid consent');
 x.send();await flush();
 assert.equal(x.stats().evalCount,1,'in-window fix is still allowed');
 assert.deepEqual(x.events,['enter']);
 x.controller.stop();
});

test('M4 monotonic 60s cap cannot be extended by Android/iOS device clock rollback',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 x.tick(M4_WATCH_MAX_MS-1000);
 x.rewindWall(50_000); // NTP/manual device time change: Date.now is now only +9s
 x.tick(2000); // real elapsed 61s; JS setTimeout callback still queued
 x.send();await flush();
 assert.equal(x.stats().evalCount,0,
   'wall-clock rollback must not authorize a location after real elapsed deadline');
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 assert.ok(x.timers.every(t=>t.cancelled));
 assert.equal(await x.controller.start(OWNER,true),true,
   'a new explicit tap establishes a fresh bounded monotonic window');
 x.controller.stop();
});

test('M4 invalid monotonic clock fails closed before any native permission or GPS',async()=>{
 const x=rig({monotonicNow:()=>NaN});
 assert.equal(await x.controller.start(OWNER,true),false);
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().watchCount,0);
 assert.equal(x.timers.length,0);
});

test('M4 backwards monotonic reading fails closed even if wall-clock remains valid',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 x.rewindMonotonic(1000);
 x.send();await flush();
 assert.equal(x.stats().evalCount,0);
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
});

test('M4 partial monotonic rollback above tap time retires foreground GPS consent',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 x.tick(40_000);
 x.send();await flush();
 assert.equal(x.stats().evalCount,1);
 assert.deepEqual(x.events,['enter']);
 // Clock goes from tap+40s to tap+20s (still ABOVE consent start).
 // Checking only against the original tap would incorrectly accept it.
 x.rewindMonotonic(20_000);
 x.send();await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().evalCount,1,
   'a partial rollback must not authorize a second private evaluation');
 assert.deepEqual(x.events,['enter']);
 assert.deepEqual(x.failures,[]);
 assert.equal(x.stats().removed,1);
 assert.ok(x.timers.every(t=>t.cancelled));
 // Neither a late callback nor an apparently recovered clock revives consent.
 x.tick(40_000);
 x.send();await flush();
 assert.equal(x.stats().evalCount,1);
});

test('M4 partial monotonic rollback during server await cannot emit stale zone alert',async()=>{
 let completeEvaluation;
 const x=rig({evaluate:()=>new Promise(resolve=>{completeEvaluation=resolve;})});
 assert.equal(await x.controller.start(OWNER,true),true);
 x.tick(40_000);
 x.send();await flush();
 assert.equal(typeof completeEvaluation,'function');
 x.rewindMonotonic(20_000);
 completeEvaluation('enter');
 await flush();
 assert.deepEqual(x.events,[],
   'an in-flight server response cannot alert after clock rollback');
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 assert.deepEqual(x.failures,[]);
});

test('M4 fresh opt-in cannot replay a recent GPS fix from an earlier consent generation',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 const priorSessionFix=x.fix();
 x.controller.stop();
 x.tick(10_000); // cached prior fix remains within normal 30s freshness
 assert.equal(await x.controller.start(OWNER,true),true);
 x.sendFix(priorSessionFix);await flush();
 assert.equal(x.stats().evalCount,0,
   'new explicit consent must not authorize a prior session coordinate');
 assert.deepEqual(x.events,[]);
 x.send();await flush();
 assert.equal(x.stats().evalCount,1);
 assert.deepEqual(x.events,['enter']);
 x.controller.stop();
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
test('M4 never emits an old geofence event after final async OS permission check races with cancellation',async()=>{
 for(const incident of ['account-switch','background','stop-restart']){
   let release,checks=0;
   const finalPermission=new Promise(resolve=>{release=resolve;});
   const x=rig({hasPermission:async()=>{
     // start() checks twice; observe() checks once before evaluation,
     // then waits here AFTER the server-confirmed event.
     if(++checks===4)return finalPermission;
     return true;
   }});
   assert.equal(await x.controller.start(OWNER,true),true);
   x.send();
   await flush();
   assert.equal(checks,4,'the last permission read is pending after evaluate');
   assert.equal(x.stats().evalCount,1);
   if(incident==='account-switch')x.setActor('anotherSubjectUid00002');
   if(incident==='background')x.setForeground(false);
   if(incident==='stop-restart'){
     x.controller.stop();
     assert.equal(await x.controller.start(OWNER,true),true);
     assert.equal(x.controller.getPhase(),'watching');
   }
   release(true); // OS read itself succeeded, but session is no longer current
   await flush();
   assert.deepEqual(x.events,[],incident+' must not surface the old event');
   assert.deepEqual(x.failures,[],'cancellation is not a current-account GPS error');
   assert.equal(x.controller.getPhase(),
     incident==='stop-restart'?'watching':'off');
   x.controller.stop();
 }
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

test('M4 late native watch bind is removed when actual Firebase identity changes',async()=>{
 let resolveWatch;
 const pending=new Promise(resolve=>{resolveWatch=resolve;});
 const x=rig({watch:()=>pending});
 const started=x.controller.start(OWNER,true);
 await flush();
 assert.equal(x.controller.getPhase(),'starting');
 x.setActor('anotherSubjectUid00002'); // auth callback may still be pending
 let removed=0;
 resolveWatch({remove:()=>{removed++;}});
 assert.equal(await started,false);
 assert.equal(removed,1);
 assert.equal(x.controller.getPhase(),'off');
 assert.deepEqual(x.failures,[]); // account switch is cancellation, not a GPS error
 x.setActor(SUBJECT);
 assert.equal(await x.controller.start(OWNER,true),true); // a fresh opt-in can start
 x.controller.stop();
 assert.equal(x.controller.getPhase(),'off');
});
test('M4 permission revoked during async native watch bind removes watcher and fails closed',async()=>{
 let resolveWatch;
 const pending=new Promise(resolve=>{resolveWatch=resolve;});
 const x=rig({watch:()=>pending});
 const started=x.controller.start(OWNER,true);
 await flush();
 x.setPermission(false);
 let removed=0;
 resolveWatch({remove:()=>{removed++;}});
 assert.equal(await started,false);
 assert.equal(removed,1);
 assert.equal(x.controller.getPhase(),'off');
 assert.deepEqual(x.failures,['error']);
 assert.ok(x.timers.every(timer=>timer.cancelled),'starting deadline must be canceled');
});
test('M4 native permission recheck error after bind still removes watcher',async()=>{
 let checks=0,removed=0;
 const x=rig({
   hasPermission:async()=>{if(++checks===2)throw Error('OS permission unavailable');return true;},
   watch:async()=>({remove:()=>{removed++;}})
 });
 assert.equal(await x.controller.start(OWNER,true),false);
 assert.equal(removed,1);
 assert.equal(x.controller.getPhase(),'off');
 assert.deepEqual(x.failures,['error']);
});
test('M4 older async bind must not stop a newer explicit foreground session',async()=>{
 let resolveOld,binds=0,removed=0;
 const old=new Promise(resolve=>{resolveOld=resolve;});
 const x=rig({watch:()=>{
   if(++binds===1)return old;
   return Promise.resolve({remove:()=>{removed++;}});
 }});
 const first=x.controller.start(OWNER,true);
 await flush();
 x.controller.stop();
 assert.equal(await x.controller.start(OWNER,true),true);
 resolveOld({remove:()=>{removed++;}});
 assert.equal(await first,false);
 assert.equal(x.controller.getPhase(),'watching');
 assert.equal(removed,1); // only stale subscription removed
 x.controller.stop();
 assert.equal(removed,2);
});

test('M4 rejected Android native start after silent identity/background loss cannot strand starting',async()=>{
 for(const stage of ['permission-request','permission-check','native-watch']){
   let rejectNative;
   const pending=new Promise((_,reject)=>{rejectNative=reject;});
   let calls=0;
   const once=()=>++calls===1?pending:Promise.resolve(
     stage==='native-watch'?{remove(){}}:true);
   const override=stage==='permission-request'?{requestPermission:once}:
     stage==='permission-check'?{hasPermission:once}:{watch:once};
   const x=rig(override);
   const first=x.controller.start(OWNER,true);
   await flush();
   assert.equal(x.controller.getPhase(),'starting',stage);
   // Delayed auth/AppState callbacks cannot be trusted to invoke interrupted().
   if(stage==='native-watch')x.setForeground(false);
   else x.setActor('anotherSubjectUid00002');
   rejectNative(Error('native permission or watch interrupted'));
   assert.equal(await first,false,stage);
   assert.equal(x.controller.getPhase(),'off',stage+' must release the GPS UI');
   assert.deepEqual(x.failures,[],stage+' is not a current-user GPS error');
   assert.ok(x.timers.every(timer=>timer.cancelled),'starting deadline must be canceled');
   x.setActor(SUBJECT);x.setForeground(true);
   assert.equal(await x.controller.start(OWNER,true),true,
     stage+' must permit a new explicit opt-in');
   x.controller.stop();
 }
});
test('M4 current-user native start rejection fails closed with an error and permits retry',async()=>{
 for(const stage of ['permission-request','permission-check','native-watch']){
   let calls=0;
   const rejectOnce=()=>++calls===1?
     Promise.reject(Error('Android native service failed')):
     Promise.resolve(stage==='native-watch'?{remove(){}}:true);
   const x=rig(stage==='permission-request'?{requestPermission:rejectOnce}:
     stage==='permission-check'?{hasPermission:rejectOnce}:{watch:rejectOnce});
   assert.equal(await x.controller.start(OWNER,true),false);
   assert.equal(x.controller.getPhase(),'off');
   assert.deepEqual(x.failures,['error']);
   assert.equal(await x.controller.start(OWNER,true),true);
   x.controller.stop();
 }
});
test('M4 stale native rejection cannot tear down a newer explicit opt-in',async()=>{
 let rejectOld,binds=0,removed=0;
 const old=new Promise((_,reject)=>{rejectOld=reject;});
 const x=rig({watch:()=>++binds===1?old:
   Promise.resolve({remove:()=>{removed++;}})});
 const first=x.controller.start(OWNER,true);
 await flush();
 x.controller.stop();
 assert.equal(await x.controller.start(OWNER,true),true);
 rejectOld(Error('old Android binder rejected after cancellation'));
 assert.equal(await first,false);
 assert.equal(x.controller.getPhase(),'watching');
 assert.deepEqual(x.failures,[]);
 assert.equal(removed,0);
 x.controller.stop();
 assert.equal(removed,1);
});

test('M4 async native OS DENIED after silent account/background change releases starting',async()=>{
 for(const incident of ['account-switch','background']){
   let resolvePermission,checks=0;
   const delayed=new Promise(resolve=>{resolvePermission=resolve;});
   const x=rig({hasPermission:()=>++checks===1?delayed:Promise.resolve(true)});
   const first=x.controller.start(OWNER,true);
   await flush();
   assert.equal(x.controller.getPhase(),'starting');
   if(incident==='account-switch')x.setActor('anotherSubjectUid00002');
   else x.setForeground(false);
   resolvePermission(false); // OS returns a normal denial, not a rejection
   assert.equal(await first,false);
   assert.equal(x.controller.getPhase(),'off',incident+' cannot strand starting');
   assert.deepEqual(x.failures,[],incident+' is not a current-account GPS error');
   assert.equal(x.stats().watchCount,0);
   assert.ok(x.timers.every(timer=>timer.cancelled),'starting deadline must be canceled');
   x.setActor(SUBJECT);x.setForeground(true);
   assert.equal(await x.controller.start(OWNER,true),true,
     'new explicit opt-in must not be blocked by stale starting');
   x.controller.stop();
 }
});

test('M4 stale async native OS DENIED cannot stop newer explicit opt-in',async()=>{
 let resolveOld,checks=0;
 const delayed=new Promise(resolve=>{resolveOld=resolve;});
 const x=rig({hasPermission:()=>++checks===1?delayed:Promise.resolve(true)});
 const first=x.controller.start(OWNER,true);
 await flush();
 x.controller.stop();
 assert.equal(await x.controller.start(OWNER,true),true);
 resolveOld(false);
 assert.equal(await first,false);
 assert.equal(x.controller.getPhase(),'watching');
 assert.deepEqual(x.failures,[]);
 x.controller.stop();
});

test('M4 current-account async native OS DENIED reports failure and permits retry',async()=>{
 let checks=0;
 const x=rig({hasPermission:async()=>++checks!==1});
 assert.equal(await x.controller.start(OWNER,true),false);
 assert.equal(x.controller.getPhase(),'off');
 assert.deepEqual(x.failures,['error']);
 assert.equal(await x.controller.start(OWNER,true),true);
 x.controller.stop();
});

test('M4 retired expiry callback cannot stop a newer explicitly opted-in Android watcher',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 const expired=x.timers[0];
 x.controller.stop();
 assert.equal(expired.cancelled,true);
 assert.equal(x.stats().removed,1);
 assert.equal(await x.controller.start(OWNER,true),true);
 const active=x.timers[1];
 assert.equal(x.controller.getPhase(),'watching');
 // clearTimeout cannot retract a callback already queued on the JS thread.
 expired.fn();
 assert.equal(x.controller.getPhase(),'watching',
   'a previous generation cannot turn off the current opt-in');
 assert.equal(x.stats().removed,1,'new native watcher must remain installed');
 assert.equal(active.cancelled,false,'new timeout must remain armed');
 x.send();
 await flush();
 assert.deepEqual(x.events,['enter'],'current watcher remains functional');
 active.fn();
 assert.equal(x.controller.getPhase(),'off','current expiry still stops');
 assert.equal(x.stats().removed,2);
 assert.equal(active.cancelled,true);
});

test('M4 canceled old expiry cannot abort replacement during asynchronous native bind',async()=>{
 let releaseSecond,binds=0,removed=0;
 const waiting=new Promise(resolve=>{releaseSecond=resolve;});
 const x=rig({watch:async()=>{
   if(++binds===2)await waiting;
   return {remove:()=>{removed++;}};
 }});
 assert.equal(await x.controller.start(OWNER,true),true);
 const expired=x.timers[0];
 x.controller.interrupted();
 assert.equal(expired.cancelled,true);
 const replacement=x.controller.start(OWNER,true);
 await flush();
 assert.equal(x.controller.getPhase(),'starting');
 expired.fn();
 assert.equal(x.controller.getPhase(),'starting');
 assert.equal(removed,1);
 releaseSecond();
 assert.equal(await replacement,true);
 assert.equal(x.controller.getPhase(),'watching');
 assert.equal(x.timers.length,2);
 x.controller.stop();
 assert.equal(removed,2);
});

test('M4 privacy deadline starts at tap even when native permission prompt never resolves',async()=>{
 let release;
 const pending=new Promise(resolve=>{release=resolve;});
 const x=rig({requestPermission:()=>pending});
 const start=x.controller.start(OWNER,true);
 assert.equal(x.controller.getPhase(),'starting');
 assert.equal(x.timers.length,1);
 assert.equal(x.timers[0].ms,M4_WATCH_MAX_MS);
 x.timers[0].fn();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.timers[0].cancelled,true);
 assert.deepEqual(x.failures,['error'],'active user gets bounded startup failure');
 release(true);
 assert.equal(await start,false);
 assert.equal(x.stats().watchCount,0);
 assert.deepEqual(x.events,[]);
 assert.equal(await x.controller.start(OWNER,true),true,'new opt-in can retry');
 x.controller.stop();
});

test('M4 late native bind after 60s deadline is removed before any additional OS await',async()=>{
 let releaseWatch,checks=0,removed=0;
 const pending=new Promise(resolve=>{releaseWatch=resolve;});
 const x=rig({
   watch:()=>pending,
   hasPermission:async()=>{++checks;return true;}
 });
 const start=x.controller.start(OWNER,true);
 await flush();
 assert.equal(x.controller.getPhase(),'starting');
 assert.equal(checks,1);
 const deadline=x.timers[0];
 deadline.fn();
 assert.equal(x.controller.getPhase(),'off');
 releaseWatch({remove:()=>{removed++;}});
 assert.equal(await start,false);
 assert.equal(removed,1,'late watcher released immediately');
 assert.equal(checks,1,'no stale OS permission query after expired native bind');
 assert.deepEqual(x.failures,['error']);
 assert.equal(await x.controller.start(OWNER,true),true);
 x.controller.stop();
});

test('M4 deadline immediately removes bound GPS while post-bind OS recheck is hung',async()=>{
 let releaseCheck,checks=0,removed=0;
 const pending=new Promise(resolve=>{releaseCheck=resolve;});
 const x=rig({
   hasPermission:()=>++checks===2?pending:Promise.resolve(true),
   watch:async()=>({remove:()=>{removed++;}})
 });
 const start=x.controller.start(OWNER,true);
 await flush();
 assert.equal(x.controller.getPhase(),'starting');
 assert.equal(checks,2);
 const deadline=x.timers[0];
 deadline.fn();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(removed,1,'GPS removed without waiting for native permission read');
 assert.deepEqual(x.failures,['error']);
 assert.equal(await x.controller.start(OWNER,true),true);
 assert.equal(x.controller.getPhase(),'watching');
 releaseCheck(true);
 assert.equal(await start,false);
 assert.equal(removed,1);
 deadline.fn();
 assert.equal(x.controller.getPhase(),'watching');
 x.controller.stop();
 assert.equal(removed,2);
});

test('M4 absolute 60s deadline denies late native GPS fix even when JS timeout callback is delayed',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 x.tick(M4_WATCH_MAX_MS+1); // OS resumed before queued setTimeout callback
 x.send();
 await flush();
 assert.equal(x.stats().evalCount,0,'expired GPS must not reach Staging evaluate');
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[],'normal expiry is not a native GPS error');
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 assert.equal(x.timers[0].cancelled,true);
 assert.equal(await x.controller.start(OWNER,true),true,'new tap is fresh consent');
 x.controller.stop();
});

test('M4 absolute deadline denies native bind that returns after wall-clock expiry before timer fires',async()=>{
 let resolveWatch,removed=0;
 const pending=new Promise(resolve=>{resolveWatch=resolve;});
 const x=rig({watch:()=>pending});
 const first=x.controller.start(OWNER,true);
 await flush();
 x.tick(M4_WATCH_MAX_MS+1);
 resolveWatch({remove:()=>{removed++;}});
 assert.equal(await first,false);
 assert.equal(removed,1,'late native watcher must be removed');
 assert.equal(x.controller.getPhase(),'off');
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
 assert.ok(x.timers.every(timer=>timer.cancelled));
});

test('M4 server event response after wall-clock consent expiry cannot trigger a stale alert',async()=>{
 let finish,evalCount=0;
 const pending=new Promise(resolve=>{finish=resolve;});
 const x=rig({evaluate:()=>{evalCount++;return pending;}});
 assert.equal(await x.controller.start(OWNER,true),true);
 x.send();
 await flush();
 assert.equal(evalCount,1);
 x.tick(M4_WATCH_MAX_MS+1);
 finish('enter');
 await flush();
 assert.deepEqual(x.events,[],'server event after expiry is suppressed');
 assert.deepEqual(x.failures,[],'natural consent expiry is not a GPS error');
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 assert.equal(x.timers[0].cancelled,true);
});

test('M4 final async OS permission recheck after wall-clock expiry suppresses event',async()=>{
 let release,checks=0;
 const pending=new Promise(resolve=>{release=resolve;});
 const x=rig({hasPermission:()=>++checks===4?pending:Promise.resolve(true)});
 assert.equal(await x.controller.start(OWNER,true),true);
 x.send();
 await flush();
 assert.equal(checks,4,'final OS permission recheck is pending');
 x.tick(M4_WATCH_MAX_MS+1);
 release(true);
 await flush();
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
});

test('M4 initial async OS permission read after wall-clock expiry never evaluates location',async()=>{
 let release,checks=0;
 const pending=new Promise(resolve=>{release=resolve;});
 const x=rig({hasPermission:()=>++checks===3?pending:Promise.resolve(true)});
 assert.equal(await x.controller.start(OWNER,true),true);
 x.send();
 await flush();
 assert.equal(checks,3,'initial OS permission check is pending');
 x.tick(M4_WATCH_MAX_MS+1);
 release(true);
 await flush();
 assert.equal(x.stats().evalCount,0,'no server request after expired consent');
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[],'natural expiry is not an OS failure');
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
});

test('M4 expired native GPS error callback releases watcher without false foreground warning',async()=>{
 const x=rig();
 assert.equal(await x.controller.start(OWNER,true),true);
 x.tick(M4_WATCH_MAX_MS+1); // setTimeout callback may still be queued
 x.err();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1,'native GPS must be released on this JS callback');
 assert.deepEqual(x.failures,[],'natural consent expiry is silent');
 assert.ok(x.timers.every(timer=>timer.cancelled));
 assert.equal(await x.controller.start(OWNER,true),true,'a new tap is fresh consent');
 x.controller.stop();
 assert.equal(x.stats().removed,2);
});

test('M4 native GPS error after silent account change retires only old watcher',async()=>{
 let errors=[],removed=0;
 const x=rig({watch:async(_fix,onError)=>{
   errors.push(onError);
   return {remove:()=>{removed++;}};
 }});
 assert.equal(await x.controller.start(OWNER,true),true);
 x.setActor('anotherSubjectUid00002'); // auth listener may still be queued
 errors[0]();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(removed,1);
 assert.deepEqual(x.failures,[],'not an error for the new account');
 x.setActor(SUBJECT);
 assert.equal(await x.controller.start(OWNER,true),true);
 errors[0](); // stale native callback cannot stop a newer opt-in
 assert.equal(x.controller.getPhase(),'watching');
 assert.equal(removed,1);
 assert.deepEqual(x.failures,[]);
 x.controller.stop();
 assert.equal(removed,2);
});

test('M4 rejected initial OS permission read after wall-clock expiry is silent',async()=>{
 let rejectPermission,checks=0;
 const pending=new Promise((_,reject)=>{rejectPermission=reject;});
 const x=rig({hasPermission:()=>++checks===3?pending:Promise.resolve(true)});
 assert.equal(await x.controller.start(OWNER,true),true);
 x.send();
 await flush();
 assert.equal(checks,3,'observe permission read is pending');
 x.tick(M4_WATCH_MAX_MS+1);
 rejectPermission(Error('OS permission query rejected after consent expired'));
 await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().evalCount,0,'no server evaluation after expired permission');
 assert.equal(x.stats().removed,1);
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[],'late OS error is not a new foreground failure');
 assert.ok(x.timers.every(timer=>timer.cancelled));
});

test('M4 rejected final OS permission read after wall-clock expiry cannot alert or warn',async()=>{
 let rejectPermission,checks=0;
 const pending=new Promise((_,reject)=>{rejectPermission=reject;});
 const x=rig({hasPermission:()=>++checks===4?pending:Promise.resolve(true)});
 assert.equal(await x.controller.start(OWNER,true),true);
 x.send();
 await flush();
 assert.equal(checks,4,'final OS permission read is pending');
 assert.equal(x.stats().evalCount,1);
 x.tick(M4_WATCH_MAX_MS+1);
 rejectPermission(Error('final OS permission query rejected after expiry'));
 await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 assert.deepEqual(x.events,[],'expired event cannot be delivered');
 assert.deepEqual(x.failures,[],'expired consent must not surface a false failure');
 assert.ok(x.timers.every(timer=>timer.cancelled));
});

test('M4 STOP invalidates consent and stale GPS callbacks even if native remove throws',async()=>{
 let callback=null,removals=0,throwFirst=true;
 const x=rig({watch:async onFix=>{
   callback=onFix;
   return {remove:()=>{
     removals++;
     if(throwFirst){throwFirst=false;throw Error('Android native subscription invalidated');}
   }};
 }});
 assert.equal(await x.controller.start(OWNER,true),true);
 const oldFix=callback;
 assert.doesNotThrow(()=>x.controller.stop(),
   'native removal failure must not strand the consent state');
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(removals,1);
 oldFix(x.fix());await flush();
 assert.equal(x.stats().evalCount,0,'old native callbacks must not reach backend');
 assert.deepEqual(x.events,[]);
 assert.equal(await x.controller.start(OWNER,true),true,
   'a new opt-in is allowed after failed native cleanup');
 oldFix(x.fix());await flush();
 assert.equal(x.stats().evalCount,0,'old generation cannot affect new consent');
 callback(x.fix());await flush();
 assert.deepEqual(x.events,['enter'],'fresh consent remains usable');
 x.controller.stop();
 assert.equal(removals,2);
});

test('M4 STOP still removes GPS and retires old expiry if timer cancellation throws',async()=>{
 let removed=0,fixCallback;
 const x=rig({
   cancel:()=>{throw Error('JS timer invalidated by runtime');},
   watch:async onFix=>{
     fixCallback=onFix;
     return {remove:()=>{removed++;}};
   }
 });
 assert.equal(await x.controller.start(OWNER,true),true);
 const expired=x.timers[0],oldFix=fixCallback;
 assert.doesNotThrow(()=>x.controller.stop());
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(removed,1,'native GPS must be released even when timer cleanup fails');
 expired.fn();oldFix(x.fix());await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().evalCount,0);
 assert.deepEqual(x.events,[]);
 assert.equal(await x.controller.start(OWNER,true),true);
 expired.fn();
 assert.equal(x.controller.getPhase(),'watching','old expiry cannot cancel new opt-in');
 x.controller.stop();
 assert.equal(removed,2);
});

test('M4 dispose is terminal before OFF UI callback can reenter a fresh GPS opt-in',async()=>{
 let controller,offCallbacks=0,permissionCalls=0,oldFix;
 const x=rig({
   requestPermission:async()=>{permissionCalls++;return true;},
   watch:async onFix=>{oldFix=onFix;return {remove:()=>{}};},
   onPhase:phase=>{
     if(phase==='off'){
       offCallbacks++;
       void controller.start(OWNER,true);
     }
   }
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),true);
 assert.equal(permissionCalls,1);
 controller.dispose();
 assert.equal(controller.getPhase(),'off');
 assert.equal(offCallbacks,0,'disposed view must not receive an OFF callback');
 assert.equal(permissionCalls,1,'dispose cannot trigger another native permission prompt');
 assert.equal(await controller.start(OWNER,true),false,'disposed controller is terminal');
 oldFix(x.fix());await flush();
 assert.equal(x.stats().evalCount,0,'retired native GPS callback cannot evaluate');
 assert.ok(x.timers.every(t=>t.cancelled),'disposal cancels expiry');
});

test('M4 synchronous dispose during STARTING UI callback cannot trigger OFF reentrancy or OS GPS',async()=>{
 let controller,offCallbacks=0,permissionCalls=0;
 const x=rig({
   requestPermission:async()=>{permissionCalls++;return true;},
   onPhase:phase=>{
     if(phase==='starting')controller.dispose();
     if(phase==='off'){
       offCallbacks++;
       void controller.start(OWNER,true);
     }
   }
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),false);
 assert.equal(controller.getPhase(),'off');
 assert.equal(offCallbacks,0,'unmounted UI must not be notified during disposal');
 assert.equal(permissionCalls,0,'no stale OS permission prompt after disposal');
 assert.equal(x.timers.length,0,'no stale deadline after disposal');
 assert.equal(x.stats().watchCount,0);
 assert.deepEqual(x.failures,[]);
});

test('M4 synchronous dispose during WATCHING UI callback releases already-bound native GPS',async()=>{
 let controller,offCallbacks=0,removals=0,oldFix;
 const x=rig({
   watch:async onFix=>{
     oldFix=onFix;
     return {remove:()=>{removals++;}};
   },
   onPhase:phase=>{
     if(phase==='watching')controller.dispose();
     if(phase==='off'){
       offCallbacks++;
       void controller.start(OWNER,true);
     }
   }
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),false);
 assert.equal(controller.getPhase(),'off');
 assert.equal(offCallbacks,0);
 assert.equal(removals,1,'native watcher must be removed exactly once');
 assert.equal(x.timers.length,1);
 assert.equal(x.timers[0].cancelled,true);
 oldFix(x.fix());await flush();
 assert.equal(x.stats().evalCount,0);
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
});

test('M4 expired STARTING deadline contains a throwing UI failure reporter without late GPS',async()=>{
 let settlePermission,permissionCalls=0;
 const pending=new Promise(resolve=>{settlePermission=resolve;});
 const x=rig({
   requestPermission:()=>{permissionCalls++;return pending;},
   onFailure:()=>{throw Error('React error boundary unmounted while reporting expiry');}
 });
 const started=x.controller.start(OWNER,true);
 assert.equal(permissionCalls,1);
 assert.equal(x.controller.getPhase(),'starting');
 assert.equal(x.timers.length,1);
 assert.doesNotThrow(()=>x.timers[0].fn(),
   'expiry timer must not leak UI callback exception into the JS event loop');
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.timers[0].cancelled,true);
 settlePermission(true);
 assert.equal(await started,false,'late native permission resolution cannot revive consent');
 assert.equal(x.stats().watchCount,0,'expired watch must not bind native GPS');
 assert.deepEqual(x.events,[]);
});

test('M4 native watcher error contains a throwing UI failure reporter after GPS STOP',async()=>{
 const x=rig({onFailure:()=>{throw Error('React error boundary failed during GPS error');}});
 assert.equal(await x.controller.start(OWNER,true),true);
 assert.doesNotThrow(()=>x.err(),
   'native OS error callback must not throw into Expo location subscription');
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1);
 x.send();await flush();
 assert.equal(x.stats().evalCount,0,'stale fix must not reach evaluator');
 assert.deepEqual(x.events,[]);
 assert.ok(x.timers.every(t=>t.cancelled));
});

test('M4 failed async zone evaluation contains a throwing UI failure reporter',async()=>{
 const x=rig({
   evaluate:async()=>{throw Error('Staging evaluator rejected expired zone grant');},
   onFailure:()=>{throw Error('React view unmounted before displaying error');}
 });
 assert.equal(await x.controller.start(OWNER,true),true);
 x.send();
 await flush();
 assert.equal(x.controller.getPhase(),'off');
 assert.equal(x.stats().removed,1,'failed server evaluation releases native GPS');
 assert.equal(x.stats().evalCount,0);
 assert.deepEqual(x.events,[],'no private zone event may be delivered');
 assert.ok(x.timers.every(t=>t.cancelled));
});

test('M4 OFF phase callback may synchronously STOP again without recursive UI notifications',async()=>{
 let controller,offCallbacks=0,permissionCalls=0,removed=0;
 const x=rig({
   requestPermission:async()=>{permissionCalls++;return true;},
   watch:async()=>({remove:()=>{removed++;}}),
   onPhase:phase=>{
     if(phase==='off'){
       offCallbacks++;
       controller.stop();
       controller.interrupted();
     }
   }
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),true);
 assert.doesNotThrow(()=>controller.stop(),
   'a synchronous React OFF observer can safely request another STOP');
 assert.equal(controller.getPhase(),'off');
 assert.equal(offCallbacks,1,'exactly one OFF callback per consent generation');
 assert.equal(removed,1,'native GPS released once');
 assert.equal(permissionCalls,1,'no permission prompt during recursive STOP');
 assert.equal(x.timers.length,1);
 assert.equal(x.timers[0].cancelled,true);
 controller.stop();controller.interrupted();
 assert.equal(offCallbacks,1,'repeated STOP on OFF must not emit duplicate UI events');
 assert.equal(removed,1);
 assert.deepEqual(x.events,[]);
 assert.deepEqual(x.failures,[]);
});

test('M4 a fresh explicit start from OFF callback survives an old STOP and stale timer',async()=>{
 let controller,restarted=null,offCallbacks=0,removed=0;
 const x=rig({
   watch:async()=>({remove:()=>{removed++;}}),
   onPhase:phase=>{
     if(phase==='off'&&offCallbacks++===0){
       controller.stop(); // reentrant duplicate must be a no-op
       restarted=controller.start(OWNER,true);
     }
   }
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),true);
 const retired=x.timers[0];
 controller.stop();
 assert.equal(await restarted,true,'explicit new opt-in can start after OFF');
 assert.equal(controller.getPhase(),'watching');
 assert.equal(offCallbacks,1,'retired OFF must not recursively notify');
 assert.equal(removed,1);
 retired.fn();
 assert.equal(controller.getPhase(),'watching','old expiry cannot stop new consent');
 assert.equal(x.timers[1].cancelled,false);
 controller.dispose();
 assert.equal(removed,2);
 assert.deepEqual(x.events,[]);
});

test('M4 synchronous timer cancellation cannot recursively STOP or request a new GPS opt-in during teardown',async()=>{
 let controller,permissionCalls=0,offCallbacks=0,attemptedDuringCleanup=null,removed=0,oldFix;
 const x=rig({
   requestPermission:async()=>{permissionCalls++;return true;},
   cancel:timer=>{
     timer.cancelled=true;
     assert.equal(controller.getPhase(),'off','internal consent must be retired before external cancellation');
     controller.stop();
     controller.interrupted();
     attemptedDuringCleanup=controller.start(OWNER,true);
   },
   watch:async onFix=>{oldFix=onFix;return {remove:()=>{removed++;}};},
   onPhase:phase=>{if(phase==='off')offCallbacks++;}
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),true);
 assert.doesNotThrow(()=>controller.stop());
 assert.equal(await attemptedDuringCleanup,false,
   'native teardown callback must not restart foreground GPS without a fresh tap');
 assert.equal(controller.getPhase(),'off');
 assert.equal(offCallbacks,1,'only one terminal OFF notification');
 assert.equal(permissionCalls,1,'no reentrant OS permission prompt');
 assert.equal(removed,1,'native GPS subscription removed exactly once');
 assert.equal(x.timers[0].cancelled,true);
 oldFix(x.fix());await flush();
 assert.equal(x.stats().evalCount,0,'retired GPS fix must not reach private evaluator');
 assert.deepEqual(x.events,[]);
});

test('M4 native GPS removal reentrancy cannot overwrite a fresh opt-in from the final OFF UI callback',async()=>{
 let controller,removed=0,offCallbacks=0,permissionCalls=0;
 let attemptedDuringCleanup=null,restartAfterCleanup=null;
 const x=rig({
   requestPermission:async()=>{permissionCalls++;return true;},
   watch:async()=>({remove:()=>{
     removed++;
     if(removed===1){
       assert.equal(controller.getPhase(),'off');
       controller.interrupted(); // synchronous OS teardown callback
       attemptedDuringCleanup=controller.start(OWNER,true);
     }
   }}),
   onPhase:phase=>{
     if(phase==='off'&&offCallbacks++===0)
       restartAfterCleanup=controller.start(OWNER,true);
   }
 });
 controller=x.controller;
 assert.equal(await controller.start(OWNER,true),true);
 const oldTimer=x.timers[0];
 assert.doesNotThrow(()=>controller.stop());
 assert.equal(await attemptedDuringCleanup,false,
   'remove() callback cannot start a new watcher while teardown is in progress');
 assert.equal(await restartAfterCleanup,true,
   'a fresh explicit start from the final OFF callback may proceed after teardown');
 assert.equal(controller.getPhase(),'watching',
   'retired outer STOP must never overwrite the newer foreground consent');
 assert.equal(offCallbacks,1);
 assert.equal(permissionCalls,2,'only the original and the fresh opt-in request GPS');
 assert.equal(removed,1,'old native watcher removed exactly once');
 oldTimer.fn();
 assert.equal(controller.getPhase(),'watching','stale timer cannot stop newer consent');
 controller.dispose();
 assert.equal(removed,2);
 assert.deepEqual(x.events,[]);
});
