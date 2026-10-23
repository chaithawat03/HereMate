/**
 * Android-only, explicit opt-in polling of already-authorized friends.
 * READ ONLY: never publishes device GPS, stores coordinates or runs after
 * app background/account change. All ACL decisions remain server-side.
 */
export const ANDROID_FRIEND_MAP_POLL_MS=30_000;
export const ANDROID_FRIEND_MAP_READ_LIMIT_PER_TICK=8;
// 8 reads x up to 3 starts in a rolling 60 second interval = 24, below
// the M2 server's 30-read/minute per-account quota, leaving headroom.
export const ANDROID_FRIEND_MAP_MAX_READS_PER_60S=24;
const UID=/^[A-Za-z0-9_-]{12,128}$/;
export type FriendMapPollPorts=Readonly<{
 isAndroid:()=>boolean;
 isForeground:()=>boolean;
 currentUid:()=>string|null;
 scheduleInterval:(callback:()=>void,ms:number)=>unknown;
 cancelInterval:(handle:unknown)=>void;
 refresh:()=>Promise<void>;
 onActive:(active:boolean)=>void;
}>;
export function createAndroidFriendMapPoller(p:FriendMapPollPorts){
 let active=false,actor:string|null=null,handle:unknown=null;
 let inFlight=false,disposed=false;
 function stop(){
   if(handle!==null){p.cancelInterval(handle);handle=null;}
   actor=null;
   if(active){active=false;if(!disposed)p.onActive(false);}
 }
 function allowed(){
   return active&&!disposed&&p.isAndroid()&&p.isForeground()&&
     actor!==null&&p.currentUid()===actor;
 }
 async function tick(){
   if(!active||disposed)return;
   if(!allowed()){stop();return;}
   if(inFlight)return; // Never overlap full friend-list + HTTP batches.
   inFlight=true;
   try{await p.refresh();}
   catch{/* The view independently displays the failed fetch, not stale pins. */}
   finally{inFlight=false;}
 }
 function start(){
   if(active||disposed||!p.isAndroid()||!p.isForeground())return false;
   const uid=p.currentUid();
   if(!uid||!UID.test(uid))return false;
   actor=uid;active=true;
   p.onActive(true);
   handle=p.scheduleInterval(()=>{void tick();},ANDROID_FRIEND_MAP_POLL_MS);
   void tick(); // An explicit user tap starts first read immediately.
   return true;
 }
 function dispose(){stop();disposed=true;}
 return Object.freeze({
   start,stop,dispose,isActive:()=>active
 });
}
