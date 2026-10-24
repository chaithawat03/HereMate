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
 let processing=false,lastFixAt=-Infinity;
 let owner:string|null=null,actor:string|null=null;
 // Reject cached fixes captured before this explicit foreground opt-in.
 // A fresh native watch can deliver an old location immediately on binding.
 let consentStartedAtMs=Infinity;
 // Absolute privacy deadline: a delayed JS timer cannot extend consent.
 let deadlineAtMs=-Infinity;
 const notify=(next:M4WatchPhase)=>{
   phase=next;
   if(!disposed)p.onPhase(next);
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
   lastFixAt=-Infinity;
   if(oldTimer!==null){try{p.cancel(oldTimer);}catch{/* retired regardless */}}
   try{oldWatcher?.remove();}catch{/* OS lifecycle must handle failed native removal */}
   notify('off');
 }
 function active(epoch:number){
   return !disposed&&epoch===generation&&phase!=='off'&&
     actor!==null&&p.identity()===actor&&p.isForeground()&&
     p.now()<deadlineAtMs;
 }
 async function start(zoneOwnerUid:string,relationshipApproved:boolean){
   if(disposed||phase!=='off'||!relationshipApproved||!UID.test(zoneOwnerUid))
     return false;
   const uid=p.identity();
   if(!uid||!UID.test(uid)||uid===zoneOwnerUid||!p.isForeground())
     return false;
   actor=uid;owner=zoneOwnerUid;
   const epoch=++generation;
   // Timer callbacks may be delayed by OS suspension or a busy JS thread.
   // All permission, native-bind and GPS callback gates also check this clock.
   consentStartedAtMs=p.now();
   deadlineAtMs=consentStartedAtMs+M4_WATCH_MAX_MS;
   notify('starting');
   try{
     // The 60-second privacy deadline begins at the user's tap, NOT after
     // native permission prompts or the async GPS watcher finally binds.
     // A hung native promise cannot leave the UI in 'starting' indefinitely.
     timer=p.schedule(()=>{
       if(epoch!==generation)return; // retired timer cannot stop a new opt-in
       // Timer itself runs at/after the deadline, so active(epoch) is
       // intentionally false. Warn only the same still-foreground account.
       const shouldWarn=phase==='starting'&&!disposed&&actor!==null&&
         p.identity()===actor&&p.isForeground();
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
     notify('watching');
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
   if(phase!=='watching'||processing||!freshFix(fix,p.now())||
      fix.capturedAtMs<consentStartedAtMs||
      fix.capturedAtMs>=deadlineAtMs)return;
   if(p.now()-lastFixAt<M4_WATCH_MIN_FIX_INTERVAL_MS)return;
   lastFixAt=p.now();
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
 function dispose(){stop();disposed=true;}
 return Object.freeze({
   start,stop,dispose,getPhase:()=>phase,
   interrupted:()=>stop()
 });
}
