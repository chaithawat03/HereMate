/**
 * Android/iOS explicit opt-in foreground polling of already-authorized friends.
 * READ ONLY: never publishes device GPS, stores coordinates or runs after
 * app background/account change. All ACL decisions remain server-side.
 * A legacy Android adapter is retained for existing callers and tests.
 */
export const ANDROID_FRIEND_MAP_POLL_MS=30_000;
export const ANDROID_FRIEND_MAP_READ_LIMIT_PER_TICK=8;
// Per-device budget: at most 2 batches x 8 peer reads in 60s = 16.
// Multiple signed-in devices may share the server's per-account quota;
// server authorization/rate limits remain authoritative on every read.
export const ANDROID_FRIEND_MAP_MAX_READS_PER_60S=16;
const WINDOW_MS=60_000;
const MAX_WINDOW_BATCHES=2;
const UID=/^[A-Za-z0-9_-]{12,128}$/;
export type FriendMapPollPorts=Readonly<{
 isAndroid:()=>boolean;
 isForeground:()=>boolean;
 currentUid:()=>string|null;
 now:()=>number;
 scheduleInterval:(callback:()=>void,ms:number)=>unknown;
 cancelInterval:(handle:unknown)=>void;
 refresh:()=>Promise<void>;
 onActive:(active:boolean)=>void;
}>;
export type ForegroundFriendMapPollPorts=Omit<FriendMapPollPorts,'isAndroid'>&Readonly<{
 isSupportedPlatform:()=>boolean;
}>;
export function createForegroundFriendMapPoller(p:ForegroundFriendMapPollPorts){
 let active=false,actor:string|null=null,handle:unknown=null;
 let generation=0,inFlightGeneration:number|null=null,disposed=false;
 // Account switching must not reset the rolling read budget for an account
 // that returns within the same minute. No coordinates or tokens are stored.
 const readStartsByUid=new Map<string,number[]>();
 function stop(){
   ++generation; // invalidate queued callbacks from the old interval
   if(handle!==null){p.cancelInterval(handle);handle=null;}
   actor=null;
   if(active){active=false;if(!disposed)p.onActive(false);}
 }
 function allowed(run:number){
   return run===generation&&active&&!disposed&&p.isSupportedPlatform()&&p.isForeground()&&
     actor!==null&&p.currentUid()===actor;
 }
 async function tick(run:number){
   if(!active||disposed||run!==generation)return;
   if(!allowed(run)){stop();return;}
   // A canceled old-account HTTP read must not block a new account's
   // explicitly started session. Its completion must not unlock this one.
   if(inFlightGeneration===run)return;
   const now=p.now();
   if(!Number.isSafeInteger(now)||now<=0){stop();return;}
   for(const [uid,starts] of readStartsByUid){
     const recent=starts.filter(t=>t>now-WINDOW_MS);
     if(recent.length)readStartsByUid.set(uid,recent);
     else readStartsByUid.delete(uid);
   }
   const uid=actor;
   if(!uid)return;
   const readStarts=readStartsByUid.get(uid)??[];
   if(readStarts.length>=MAX_WINDOW_BATCHES)return;
   readStarts.push(now);
   readStartsByUid.set(uid,readStarts);
   inFlightGeneration=run;
   try{await p.refresh();}
   catch{/* The view independently displays the failed fetch, not stale pins. */}
   finally{if(inFlightGeneration===run)inFlightGeneration=null;}
 }
 function start(){
   if(active||disposed||!p.isSupportedPlatform()||!p.isForeground())return false;
   const uid=p.currentUid();
   if(!uid||!UID.test(uid))return false;
   const run=++generation;
   actor=uid;active=true;
   // The UI activation callback can synchronously stop/dispose or replace
   // this account's opt-in. Never resurrect its old timer afterwards.
   try{p.onActive(true);}
   catch{
     if(run===generation){++generation;actor=null;active=false;}
     return false;
   }
   if(!allowed(run)){
     if(run===generation)stop();
     return false;
   }
   let scheduled:unknown;
   try{
     scheduled=p.scheduleInterval(()=>{void tick(run);},ANDROID_FRIEND_MAP_POLL_MS);
   }catch{
     if(run===generation)stop();
     return false;
   }
   // A synchronous native/timer adapter can STOP before returning its handle.
   // Cancel that handle without touching a replacement generation.
   if(scheduled==null){
     if(run===generation)stop();
     return false;
   }
   if(!allowed(run)){
     try{p.cancelInterval(scheduled);}catch{/* Old callback remains fenced. */}
     if(run===generation)stop();
     return false;
   }
   handle=scheduled;
   void tick(run); // An explicit user tap starts first read immediately.
   return true;
 }
 function dispose(){
   // Fence reentrant onActive(false) before unmount teardown.
   disposed=true;stop();
 }
 return Object.freeze({
   start,stop,dispose,isActive:()=>active
 });
}

/** Keep the original Android-only API and its fail-closed platform gate. */
export function createAndroidFriendMapPoller(p:FriendMapPollPorts){
 return createForegroundFriendMapPoller({...p,isSupportedPlatform:p.isAndroid});
}
