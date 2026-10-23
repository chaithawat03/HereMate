/**
 * Android-only, explicit opt-in polling of already-authorized friends.
 * READ ONLY: never publishes device GPS, stores coordinates or runs after
 * app background/account change. All ACL decisions remain server-side.
 */
export const ANDROID_FRIEND_MAP_POLL_MS=30_000;
export const ANDROID_FRIEND_MAP_READ_LIMIT_PER_TICK=8;
// At most 2 batches x 8 peer reads within any rolling 60s = 16,
// below the M2 server's 30-read/minute per-account quota.
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
export function createAndroidFriendMapPoller(p:FriendMapPollPorts){
 let active=false,actor:string|null=null,handle:unknown=null;
 let inFlight=false,disposed=false;
 let lastBudgetUid:string|null=null,readStarts:number[]=[];
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
   const now=p.now();
   if(!Number.isSafeInteger(now)||now<=0){stop();return;}
   // Bound transient retries/restarts too, not just uninterrupted 30s
   // intervals. A per-owner rolling-minute allowance of 2 x 8 reads
   // leaves sufficient capacity for one manual refresh.
   readStarts=readStarts.filter(t=>t>now-WINDOW_MS);
   if(readStarts.length>=MAX_WINDOW_BATCHES)return;
   readStarts.push(now);
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
   if(lastBudgetUid!==uid){lastBudgetUid=uid;readStarts=[];}
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
