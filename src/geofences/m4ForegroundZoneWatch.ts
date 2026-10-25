/**
 * M4 opt-in 60-second FOREGROUND-only zone monitoring.
 * No background execution, persistent GPS, push subscription or auto-start.
 * A trusted Staging API revalidates zone/M1/M2 authorization for every fix.
 */
import type {ShareFix} from '../location/m2ForegroundSession';
const freshFix=(fix:ShareFix,now:number)=>
 Number.isSafeInteger(fix?.capturedAtMs)&&fix.capturedAtMs>=now-30_000&&
 fix.capturedAtMs<=now+5000&&Number.isFinite(fix.latitude)&&
 fix.latitude>=-90&&fix.latitude<=90&&Number.isFinite(fix.longitude)&&
 fix.longitude>=-180&&fix.longitude<=180&&
 Number.isFinite(fix.accuracyMeters)&&fix.accuracyMeters>=0&&
 fix.accuracyMeters<=100;
export const M4_WATCH_MAX_MS=60_000;
export const M4_WATCH_MIN_FIX_INTERVAL_MS=10_000;
export type M4WatchPhase='off'|'starting'|'watching';
export type M4WatchPorts=Readonly<{
 identity:()=>string|null;
 isForeground:()=>boolean;
 requestPermission:()=>Promise<boolean>;
 hasPermission:()=>Promise<boolean>;
 watch:(onFix:(fix:ShareFix)=>void,onError:()=>void)=>Promise<{remove:()=>void}>;
 evaluate:(zoneOwnerUid:string,fix:ShareFix)=>Promise<'enter'|'exit'|null>;
 now:()=>number;
 // Monotonic elapsed time: wall-clock changes must never extend consent.
 monotonicNow:()=>number;
 schedule:(fn:()=>void,delayMs:number)=>unknown;
 cancel:(handle:unknown)=>void;
 onPhase:(phase:M4WatchPhase)=>void;
 onEvent:(event:'enter'|'exit')=>void;
 onFailure:()=>void;
}>;
const UID=/^[A-Za-z0-9_-]{12,128}$/;
export function createM4ForegroundZoneWatch(p:M4WatchPorts){
 let phase:M4WatchPhase='off',generation=0,disposed=false;
 let watcher:{remove:()=>void}|null=null,timer:unknown=null;
 // Throttle private evaluations by elapsed monotonic time, not Date.now().
 // Wall-clock forward jumps must not bypass the 10-second rate boundary.
 let processing=false,lastFixMonotonicMs=-Infinity;
 let owner:string|null=null,actor:string|null=null;
 // Reject cached fixes captured before this explicit foreground opt-in.
 // A fresh native watch can deliver an old location immediately on binding.
 let consentStartedAtMs=Infinity;
 // Absolute privacy deadline: a delayed JS timer cannot extend consent.
 let deadlineAtMs=-Infinity;
 // Date.now() can move backwards on device clock/NTP adjustments.
 // Independently enforce the tap-to-expiry duration with monotonic time.
 let consentStartedMonotonicMs=Infinity,deadlineMonotonicMs=-Infinity;
 // Detect rollback even when a broken monotonic clock stays above tap time.
 // Otherwise a partial rollback could extend a 60-second consent window.
 let lastObservedMonotonicMs=-Infinity;
 // Read mutable phase after synchronous UI callbacks without TS stale narrowing.
 const phaseIs=(expected:M4WatchPhase)=>phase===expected;
 const notify=(next:M4WatchPhase)=>{
   phase=next;
   if(disposed)return true;
   // A React/UI adapter can throw during a native lifecycle transition.
   // Treat it as failed consent establishment rather than leaving GPS live
   // without a reliable foreground indicator. STOP itself never throws.
   try{p.onPhase(next);return true;}catch{return false;}
 };
 function stop(){
   // Retire the consent generation and clear all JS state BEFORE invoking
   // native cleanup. Expo's native subscription can throw during OS teardown
   // or permission revocation; that must never strand the UI in 'watching'
   // or permit an old GPS callback to send a private fix.
   ++generation;
   const oldTimer=timer,oldWatcher=watcher;
   timer=null;watcher=null;
   owner=null;actor=null;processing=false;deadlineAtMs=-Infinity;
   consentStartedAtMs=Infinity;
   consentStartedMonotonicMs=Infinity;deadlineMonotonicMs=-Infinity;
   lastObservedMonotonicMs=-Infinity;
   lastFixMonotonicMs=-Infinity;
   if(oldTimer!==null){try{p.cancel(oldTimer);}catch{/* retired regardless */}}
   try{oldWatcher?.remove();}catch{/* OS lifecycle must handle failed native removal */}
   notify('off');
 }
 // Every monotonic reading is checked against the preceding reading, not
 // merely against the tap. A 50s -> 20s clock rollback is still > tap time,
 // but must not grant another 30s of location access.
 function monotonicSample(){
   let sample:number;
   try{sample=p.monotonicNow();}catch{return NaN;}
   if(!Number.isFinite(sample)||sample<lastObservedMonotonicMs)return NaN;
   lastObservedMonotonicMs=sample;
   return sample;
 }
 function active(epoch:number){
   if(disposed||epoch!==generation||phase==='off'||actor===null)return false;
   // Runtime/OS adapter failures cannot authorize an existing GPS consent.
   // Callers retire the current watcher on a false result.
   try{
     return p.identity()===actor&&p.isForeground()&&
       p.now()<deadlineAtMs&&
       monotonicSample()>=consentStartedMonotonicMs&&
       monotonicSample()<deadlineMonotonicMs;
   }catch{return false;}
 }
 async function start(zoneOwnerUid:string,relationshipApproved:boolean){
   if(disposed||phase!=='off'||!relationshipApproved||!UID.test(zoneOwnerUid))
     return false;
   let uid:string|null;
   try{
     uid=p.identity();
     if(!uid||!UID.test(uid)||uid===zoneOwnerUid||!p.isForeground())
       return false;
   }catch{return false;}
   // A non-finite clock cannot establish a bounded private GPS consent.
   // Native/JS clock adapters can throw during runtime suspension or
   // instrumentation. No opt-in has been established yet, so reject without
   // creating a timer, requesting OS permission, or rejecting the UI promise.
   let wallNow:number,monoNow:number;
   try{wallNow=p.now();monoNow=p.monotonicNow();}
   catch{return false;}
   if(!Number.isSafeInteger(wallNow)||!Number.isFinite(monoNow))return false;
   actor=uid;owner=zoneOwnerUid;
   const epoch=++generation;
   // Timer callbacks may be delayed by OS suspension or a busy JS thread.
   // All permission, native-bind and GPS callback gates also check this clock.
   consentStartedAtMs=wallNow;
   deadlineAtMs=consentStartedAtMs+M4_WATCH_MAX_MS;
   consentStartedMonotonicMs=monoNow;
   deadlineMonotonicMs=monoNow+M4_WATCH_MAX_MS;
   lastObservedMonotonicMs=monoNow;
   if(!notify('starting')){
     if(epoch===generation)stop();
     return false;
   }
   // The UI adapter may synchronously call STOP/dispose or replace consent
   // while handling STARTING. Never prompt for permission or arm a timer
   // for a generation that no longer has the user's opt-in.
   if(epoch!==generation||!phaseIs('starting')||disposed||!active(epoch)){
     if(epoch===generation)stop();
     return false;
   }
   try{
     // The 60-second privacy deadline begins at the user's tap, NOT after
     // native permission prompts or the async GPS watcher finally binds.
     // A hung native promise cannot leave the UI in 'starting' indefinitely.
     timer=p.schedule(()=>{
       if(epoch!==generation)return; // retired timer cannot stop a new opt-in
       // Timer itself runs at/after the deadline, so active(epoch) is
       // intentionally false. Warn only the same still-foreground account.
       let shouldWarn=false;
       try{
         shouldWarn=phase==='starting'&&!disposed&&actor!==null&&
           p.identity()===actor&&p.isForeground();
       }catch{/* a failed identity/OS adapter cannot postpone GPS STOP */}
       stop();
       if(shouldWarn)p.onFailure();
     },M4_WATCH_MAX_MS);
     const granted=await p.requestPermission();
     if(!active(epoch)){if(epoch===generation)stop();return false;}
     if(!granted||!(await p.hasPermission())){
       // The OS may return DENIED after a silent account/background change.
       // active(epoch) is then false, but this generation still owns the
       // 'starting' phase. Release it without blaming the next account.
       // Never tear down a newer explicit opt-in generation.
       if(epoch===generation){
         const warn=active(epoch);
         stop();
         if(warn)p.onFailure();
       }
       return false;
     }
     if(!active(epoch)){if(epoch===generation)stop();return false;}
     const sub=await p.watch(fix=>{void observe(fix,epoch);},()=>{
       // Even when the wall-clock cap expired before JS setTimeout fires,
       // a native error callback must release the watcher immediately.
       // Only an active, still-consenting foreground account gets an error.
       if(epoch!==generation||disposed)return;
       const shouldWarn=active(epoch);
       stop();
       if(shouldWarn)p.onFailure();
     });
     // A late native bind after timeout, logout or backgrounding must be
     // removed BEFORE another async OS permission read can itself hang.
     if(!active(epoch)){
       sub.remove();
       // A silent Firebase account/background change may precede its UI
       // callback; retire this generation but never touch a newer session.
       if(epoch===generation)stop();
       return false;
     }
     // Own the native handle before awaiting the final permission check:
     // STOP or the 60-second deadline can now release GPS immediately.
     watcher=sub;
     let stillPermitted=false;
     try{stillPermitted=await p.hasPermission();}catch{/* fail closed */}
     if(!active(epoch)||!stillPermitted){
       // stop() may already have removed this handle during the await.
       if(watcher===sub){watcher=null;sub.remove();}
       if(epoch===generation){
         const warn=active(epoch)&&!stillPermitted;
         stop();
         if(warn)p.onFailure();
       }
       return false;
     }
     const phaseAccepted=notify('watching');
     // A UI adapter can synchronously STOP or establish a newer explicit
     // opt-in while processing WATCHING. Do not report the retired start as
     // successful or STOP the newer session on adapter failure.
     if(!phaseAccepted||epoch!==generation||!phaseIs('watching')||disposed||!active(epoch)){
       if(epoch===generation)stop();
       return false;
     }
     return true;
   }catch{
     // Android can reject a permission prompt or native watch bind AFTER a
     // silent Firebase account switch/background transition. In that case
     // active(epoch) is already false, but this generation still owns the
     // 'starting' phase. Always release it, without blaming the new account.
     // A stale rejected bind must NEVER stop a newer explicit opt-in session.
     if(epoch===generation){
       const warn=active(epoch);
       stop();
       if(warn)p.onFailure();
     }
     return false;
   }
 }
 async function observe(fix:ShareFix,epoch:number){
   if(!active(epoch)){if(epoch===generation)stop();return;}
   // A GPS fix may be fresh by age yet have been captured before consent.
   // Never send that pre-opt-in location to the private Staging evaluator.
   // A native fix timestamp may lead JS wall-clock by up to 5 seconds.
   // Even such a fresh fix cannot be captured beyond this tap's consent cap.
   if(phase!=='watching'||processing)return;
   // A throwing JS clock adapter after a native fix must retire consent,
   // not reject an unobserved async GPS callback or leak the fix to Staging.
   let fixNow:number;
   try{fixNow=p.now();}catch{if(epoch===generation)stop();return;}
   if(!freshFix(fix,fixNow)||fix.capturedAtMs<consentStartedAtMs||
      fix.capturedAtMs>=deadlineAtMs)return;
   const sampledMonotonicMs=monotonicSample();
   // A second clock sample can be invalid or expire after active(epoch).
   // In that case retire consent before any OS query or private evaluate.
   if(!Number.isFinite(sampledMonotonicMs)||
      sampledMonotonicMs<consentStartedMonotonicMs||
      sampledMonotonicMs>=deadlineMonotonicMs){
     if(epoch===generation)stop();
     return;
   }
   if(sampledMonotonicMs-lastFixMonotonicMs<
      M4_WATCH_MIN_FIX_INTERVAL_MS)return;
   lastFixMonotonicMs=sampledMonotonicMs;
   processing=true;
   const destination=owner;
   try{
     const permittedBeforeEvaluate=await p.hasPermission();
     // A suspended JS thread can resume after the 60s cap while the initial
     // OS permission read is pending. Do not evaluate or report a false error.
     if(!active(epoch)){
       if(epoch===generation)stop();
       return;
     }
     if(!permittedBeforeEvaluate)throw Error('revoked');
     if(!destination)throw Error('no-owner');
     const event=await p.evaluate(destination,fix);
     // A delayed server response may arrive after the wall-clock consent cap,
     // even when the JS expiry timer has not fired. Do not query OS or alert.
     if(!active(epoch)){
       if(epoch===generation)stop();
       return;
     }
     // Recheck OS permission after the async server response. A delayed OS
     // read may race STOP, account changes, backgrounding or wall-clock expiry.
     const stillPermitted=await p.hasPermission();
     if(!active(epoch)){
       if(epoch===generation)stop();
       return;
     }
     if(!stillPermitted)throw Error('revoked');
     if(event==='enter'||event==='exit')p.onEvent(event);
   }catch{
     if(!disposed&&epoch===generation){
       // A native permission rejection or server failure can settle after
       // consent expiry while the JS timer is suspended. Retire the watcher,
       // but never show a false current-user error for an expired session.
       const shouldWarn=active(epoch);
       stop();
       if(shouldWarn)p.onFailure();
     }
   }finally{
     if(epoch===generation)processing=false;
   }
 }
 function dispose(){
   // Disposal is terminal. Mark it BEFORE STOP's UI notification/cleanup:
   // a synchronous onPhase('off') callback must not reenter start() while
   // the component is unmounting and launch a new OS permission request.
   // notify() intentionally suppresses UI updates after disposal.
   disposed=true;
   stop();
 }
 return Object.freeze({
   start,stop,dispose,getPhase:()=>phase,
   interrupted:()=>stop()
 });
}
