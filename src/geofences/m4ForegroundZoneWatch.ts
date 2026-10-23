/**
 * M4 opt-in 60-second FOREGROUND-only zone monitoring.
 * No background TaskManager, persistent GPS, push subscription or auto-start.
 * A trusted Staging API revalidates zone/M1/M2 authorization for every fix.
 */
import {freshShareFix,type ShareFix} from '../location/m2ForegroundSession';
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
 const notify=(next:M4WatchPhase)=>{
   phase=next;
   if(!disposed)p.onPhase(next);
 };
 function stop(){
   ++generation;
   if(timer!==null){p.cancel(timer);timer=null;}
   watcher?.remove();watcher=null;
   owner=null;actor=null;processing=false;
   lastFixAt=-Infinity;
   notify('off');
 }
 function active(epoch:number){
   return !disposed&&epoch===generation&&phase!=='off'&&
     actor!==null&&p.identity()===actor&&p.isForeground();
 }
 async function start(zoneOwnerUid:string,relationshipApproved:boolean){
   if(disposed||phase!=='off'||!relationshipApproved||!UID.test(zoneOwnerUid))
     return false;
   const uid=p.identity();
   if(!uid||!UID.test(uid)||uid===zoneOwnerUid||!p.isForeground())
     return false;
   actor=uid;owner=zoneOwnerUid;
   const epoch=++generation;
   notify('starting');
   try{
     const granted=await p.requestPermission();
     if(!active(epoch))return false;
     if(!granted||!(await p.hasPermission())){
       if(active(epoch)){stop();p.onFailure();}
       return false;
     }
     if(!active(epoch))return false;
     const sub=await p.watch(fix=>{void observe(fix,epoch);},()=>{
       if(active(epoch)){stop();p.onFailure();}
     });
     if(!active(epoch)){sub.remove();return false;}
     watcher=sub;
     notify('watching');
     timer=p.schedule(()=>stop(),M4_WATCH_MAX_MS);
     return true;
   }catch{
     if(active(epoch)){stop();p.onFailure();}
     return false;
   }
 }
 async function observe(fix:ShareFix,epoch:number){
   if(!active(epoch)){if(epoch===generation)stop();return;}
   if(phase!=='watching'||processing||!freshShareFix(fix,p.now()))return;
   if(p.now()-lastFixAt<M4_WATCH_MIN_FIX_INTERVAL_MS)return;
   lastFixAt=p.now();
   processing=true;
   const destination=owner;
   try{
     if(!(await p.hasPermission())||!active(epoch))throw Error('revoked');
     if(!destination)throw Error('no-owner');
     const event=await p.evaluate(destination,fix);
     if(!active(epoch)||!(await p.hasPermission()))throw Error('revoked');
     if(event==='enter'||event==='exit')p.onEvent(event);
   }catch{
     if(active(epoch)){stop();p.onFailure();}
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
