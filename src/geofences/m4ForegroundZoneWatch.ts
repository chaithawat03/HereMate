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
// A v2 publisher lease may be retired without any subsequent native GPS fix.
// Bound native watcher teardown even when Android/iOS stops delivering fixes.
export const M4_WATCH_LEASE_RECHECK_MS=5_000;
export type M4WatchPhase='off'|'starting'|'watching';
export type M4WatchPorts=Readonly<{
 identity:()=>string|null;
 isForeground:()=>boolean;
 requestPermission:()=>Promise<boolean>;
 hasPermission:()=>Promise<boolean>;
 watch:(onFix:(fix:ShareFix)=>void,onError:()=>void)=>Promise<{remove:()=>void}>;
 evaluate:(zoneOwnerUid:string,fix:ShareFix)=>Promise<'enter'|'exit'|null>;
 /** Exact M3 lease proof captured before requesting OS GPS permission or
  * installing a native watcher. Retiring this lease cancels the watch. */
 captureWatchLeaseProof?:(zoneOwnerUid:string)=>()=>boolean;
 /** Optional final in-memory M3 lease proof, checked AFTER async OS permission. */
 isEvaluationStillAuthorized?:(zoneOwnerUid:string)=>boolean;
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
 let leaseRecheckTimer:unknown=null;
 let processing=false,lastFixAt=-Infinity;
 let owner:string|null=null,actor:string|null=null;
 let watchLeaseProof:(()=>boolean)|null=null;
 const leaseCurrent=(proof:(()=>boolean)|null)=>{
   try{return proof===null||proof()===true;}catch{return false;}
 };
 const notify=(next:M4WatchPhase)=>{
   phase=next;
   if(!disposed)p.onPhase(next);
 };
 function stop(){
   ++generation;
   if(timer!==null){p.cancel(timer);timer=null;}
   if(leaseRecheckTimer!==null){p.cancel(leaseRecheckTimer);leaseRecheckTimer=null;}
   watcher?.remove();watcher=null;
   owner=null;actor=null;watchLeaseProof=null;processing=false;
   lastFixAt=-Infinity;
   notify('off');
 }
 function active(epoch:number){
   return !disposed&&epoch===generation&&phase!=='off'&&
     actor!==null&&p.identity()===actor&&p.isForeground()&&
     leaseCurrent(watchLeaseProof);
 }
 // STOP/expiry/handoff can retire the M3 lease while native GPS is silent.
 // Do not wait for another location fix to release the OS watcher. A stale
 // queued recheck must never stop a newer explicitly authorized generation.
 function scheduleLeaseRecheck(epoch:number){
   if(watchLeaseProof===null||epoch!==generation||phase!=='watching')return;
   leaseRecheckTimer=p.schedule(()=>{
     if(epoch!==generation||phase!=='watching')return;
     leaseRecheckTimer=null;
     if(!active(epoch)){stop();return;}
     scheduleLeaseRecheck(epoch);
   },M4_WATCH_LEASE_RECHECK_MS);
 }
 async function start(zoneOwnerUid:string,relationshipApproved:boolean){
   if(disposed||phase!=='off'||!relationshipApproved||!UID.test(zoneOwnerUid))
     return false;
   const uid=p.identity();
   if(!uid||!UID.test(uid)||uid===zoneOwnerUid||!p.isForeground())
     return false;
   // A consented friendship is not itself a valid device-publisher lease.
   // Deny before asking the OS for GPS or binding a native watcher.
   let proof:(()=>boolean)|null=null;
   try{proof=p.captureWatchLeaseProof?.(zoneOwnerUid)??null;}
   catch{return false;}
   if(!leaseCurrent(proof))return false;
   actor=uid;owner=zoneOwnerUid;watchLeaseProof=proof;
   const epoch=++generation;
   notify('starting');
   try{
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
       if(active(epoch)){stop();p.onFailure();}
     });
     // Permission or Firebase identity can change while the native watcher
     // subscription is being established. Recheck AFTER the async bind and
     // release its native handle before returning; otherwise a late bind can
     // strand this controller in 'starting' with an unowned GPS subscription.
     let stillPermitted=false;
     try{stillPermitted=await p.hasPermission();}catch{/* fail closed */}
     if(!active(epoch)||!stillPermitted){
       sub.remove();
       if(epoch===generation){
         const warn=active(epoch)&&!stillPermitted;
         stop();
         if(warn)p.onFailure();
       }
       return false;
     }
     watcher=sub;
     notify('watching');
     // Android/JS may run a timeout callback already queued before cancel().
     // Only this exact opt-in watcher may expire itself: a retired timeout
     // must not terminate a newer consented foreground watcher.
     timer=p.schedule(()=>{if(epoch===generation)stop();},M4_WATCH_MAX_MS);
     scheduleLeaseRecheck(epoch);
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
   if(phase!=='watching'||processing||!freshFix(fix,p.now()))return;
   if(p.now()-lastFixAt<M4_WATCH_MIN_FIX_INTERVAL_MS)return;
   lastFixAt=p.now();
   processing=true;
   const destination=owner;
   try{
     if(!(await p.hasPermission())||!active(epoch))throw Error('revoked');
     if(!destination)throw Error('no-owner');
     const event=await p.evaluate(destination,fix);
     // The final OS permission read is asynchronous: STOP, backgrounding or
     // Firebase account changes may happen while it is pending. Recheck the
     // same watcher generation AFTER the await, before any subject-only alert.
     const stillPermitted=await p.hasPermission();
     if(!stillPermitted||!active(epoch)||
        (p.isEvaluationStillAuthorized!==undefined&&
         !p.isEvaluationStillAuthorized(destination)))throw Error('revoked');
     if(event==='enter'||event==='exit')p.onEvent(event);
   }catch{
     if(!disposed&&epoch===generation){
       const shouldWarn=p.isForeground()&&p.identity()===actor;
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
