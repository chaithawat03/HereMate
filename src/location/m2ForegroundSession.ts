/**
 * M2.2 foreground-only sharing coordinator. Not mounted in App; no transport
 * or backend endpoint is configured. All injected ports must be authenticated
 * and gate real network sharing behind a separate reviewed M2 enablement.
 */
export type ShareFix=Readonly<{
  latitude:number;longitude:number;accuracyMeters:number;capturedAtMs:number;
}>;
export type ShareRelation=Readonly<{
  senderUid:string;recipientUid:string;status:'accepted'|'pending'|'removed'|'declined'|'cancelled';
  senderConsent:boolean;recipientConsent:boolean;
}>;
export type SharingState=Readonly<{
  phase:'off'|'starting'|'sharing'|'stopping'|'stop-unconfirmed'|'error';
  peerUid:string|null;expiresAtMs:number|null;
  error:'permission'|'ineligible'|'backend'|null;
}>;
export type Unsubscribe=Readonly<{remove:()=>void}>;
export type SharePorts={
  ownerUid:()=>string|null;
  isForeground:()=>boolean;
  askForegroundPermission:()=>Promise<boolean>;
  watchForegroundFix:(onFix:(fix:ShareFix)=>void,onError:()=>void)=>Promise<Unsubscribe>;
  transport:{
    start:(peerUid:string)=>Promise<{enabled:boolean;expiresAtMs:number}>;
    publish:(peerUid:string,fix:ShareFix)=>Promise<{stored:boolean;expiresAtMs:number}>;
    stop:(peerUid:string)=>Promise<{enabled:boolean}>;
  };
  now:()=>number;
  schedule:(fn:()=>void,delayMs:number)=>unknown;
  cancel:(handle:unknown)=>void;
  onState:(state:SharingState)=>void;
};
const CODE=/^[A-Za-z0-9_-]{12,128}$/;
const off:SharingState={phase:'off',peerUid:null,expiresAtMs:null,error:null};
export const MAX_SHARE_SESSION_MS=60_000;
export const MIN_FIX_INTERVAL_MS=10_000;
export function isEligibleToStart(relation:ShareRelation,ownerUid:string,peerUid:string):boolean {
  return CODE.test(ownerUid)&&CODE.test(peerUid)&&peerUid!==ownerUid&&
    relation.status==='accepted' &&
    ((relation.senderUid===ownerUid&&relation.recipientUid===peerUid) ||
      (relation.recipientUid===ownerUid&&relation.senderUid===peerUid)) &&
    relation.senderConsent===true&&relation.recipientConsent===true;
}
export function freshShareFix(fix:ShareFix,now:number):boolean {
  return Number.isFinite(now)&&Number.isFinite(fix.latitude)&&
    fix.latitude>=-90&&fix.latitude<=90&&Number.isFinite(fix.longitude)&&
    fix.longitude>=-180&&fix.longitude<=180&&Number.isFinite(fix.accuracyMeters)&&
    fix.accuracyMeters>=0&&fix.accuracyMeters<=200&&
    Number.isFinite(fix.capturedAtMs)&&fix.capturedAtMs>=now-30_000&&
    fix.capturedAtMs<=now+5_000;
}
export function createForegroundSharingController(p:SharePorts) {
  let state:SharingState=off, epoch=0, disposed=false;
  let watch:Unsubscribe|null=null, alarm:unknown=null, inStart:Promise<void>|null=null;
  let inPublish:Promise<void>|null=null, inStop:Promise<void>|null=null;
  let lastPublishAt=-Infinity,activeOwner:string|null=null;
  const publishState=(next:SharingState)=>{
    state=next;
    if(!disposed)p.onState(next);
  };
  const cancelLocal=()=>{
    if(alarm!==null){p.cancel(alarm);alarm=null;}
    watch?.remove();watch=null;
  };
  async function stop():Promise<void> {
    if(inStop)return inStop;
    const peer=state.peerUid;
    ++epoch;activeOwner=null;cancelLocal();
    if(!peer){publishState(off);return;}
    publishState({phase:'stopping',peerUid:peer,expiresAtMs:null,error:null});
    const task=(async()=>{
      // Stop is serialized after outstanding Start/Publish: otherwise a late
      // network response could recreate an apparently revoked live fix.
      await Promise.allSettled([inStart,inPublish].filter(Boolean));
      try {
        const result=await p.transport.stop(peer);
        if(result.enabled!==false)throw Error('unconfirmed');
        publishState(off);
      }catch{
        // Do not claim remote sharing is stopped: a 60s backend TTL limits
        // exposure, but remote revocation is not confirmed until retry succeeds.
        publishState({phase:'stop-unconfirmed',peerUid:peer,expiresAtMs:null,error:'backend'});
      }
    })();
    inStop=task;
    try {await task;}finally{inStop=null;}
  }
  async function retryStop():Promise<void> {
    if(state.phase!=='stop-unconfirmed')return;
    return stop();
  }
  function acknowledgeEmergencyStop(peerUid:string):void {
    // Only the caller may invoke this after a successful authenticated
    // server STOP response. A failed/timeout request must keep the UI in
    // stop-unconfirmed; never silently switch to OFF.
    if(!disposed&&state.phase==='stop-unconfirmed'&&state.peerUid===peerUid){
      ++epoch;activeOwner=null;cancelLocal();publishState(off);
    }
  }
  async function start(peerUid:string,relation:ShareRelation):Promise<void> {
    if(disposed||state.phase!=='off'||inStart||inStop)return;
    const owner=p.ownerUid();
    if(!owner||!isEligibleToStart(relation,owner,peerUid)||!p.isForeground()){
      publishState({...off,error:'ineligible'});return;
    }
    const run=++epoch;
    const active=()=>!disposed&&run===epoch&&p.ownerUid()===owner&&p.isForeground();
    lastPublishAt=-Infinity;
    activeOwner=owner;
    publishState({phase:'starting',peerUid,expiresAtMs:null,error:null});
    const task=(async()=>{
      // A timed-out START may have committed a remote grant even without an
      // ACK. Permission checks cannot have created a remote grant yet.
      let remoteGrantPossible=false;
      try {
        const permitted=await p.askForegroundPermission();
        if(!active()){
          if(run===epoch){activeOwner=null;publishState(off);}
          return;
        }
        if(!permitted){activeOwner=null;publishState({...off,error:'permission'});return;}
        remoteGrantPossible=true;
        const grant=await p.transport.start(peerUid);
        if(!active()){
          // An auth/AppState callback may lag behind the actual account or
          // foreground change. Revoke a possibly committed grant even when
          // no explicit STOP event has arrived yet.
          if(run===epoch)void stop();
          return;
        }
        const now=p.now();
        if(grant.enabled!==true||!Number.isFinite(grant.expiresAtMs)||
           grant.expiresAtMs<=now||grant.expiresAtMs>now+MAX_SHARE_SESSION_MS)
          throw Error('bad_grant');
        const sub=await p.watchForegroundFix(onFix,()=>{void stop();});
        if(!active()){
          sub.remove();
          if(run===epoch)void stop();
          return;
        }
        watch=sub;
        publishState({phase:'sharing',peerUid,expiresAtMs:grant.expiresAtMs,error:null});
        alarm=p.schedule(()=>{void stop();},Math.max(0,grant.expiresAtMs-p.now()));
      }catch{
        if(run===epoch){
          if(remoteGrantPossible){
            // The server may have committed START before an HTTP failure.
            // Preserve stop-unconfirmed if revocation cannot be verified.
            void stop(); // Do not await ourselves: Stop waits for inStart.
          }else{
            // A rejected native permission prompt cannot create a remote
            // lease. A silent account/background change must not strand the
            // controller in 'starting' or claim a backend STOP failed.
            const warn=active();
            activeOwner=null;
            publishState({...off,error:warn?'permission':null});
          }
        }
      }
    })();
    inStart=task;
    try{await task;}finally{if(inStart===task)inStart=null;}
  }
  function onFix(fix:ShareFix):void {
    if(state.phase!=='sharing')return;
    if(!p.isForeground()||p.ownerUid()!==activeOwner){void stop();return;}
    const peer=state.peerUid,expires=state.expiresAtMs,now=p.now();
    if(!peer||expires===null||now>=expires){void stop();return;}
    if(!freshShareFix(fix,now))return;
    if(inPublish||now-lastPublishAt<MIN_FIX_INTERVAL_MS)return;
    lastPublishAt=now;
    const run=epoch;
    const task=(async()=>{
      try {
        const result=await p.transport.publish(peer,fix);
        if(run!==epoch)return;
        if(result.stored!==true||!Number.isFinite(result.expiresAtMs)||
           result.expiresAtMs<=p.now()||result.expiresAtMs>expires)
          throw Error('invalid_server_result');
      }catch{
        if(run===epoch)void stop();
      }
    })();
    inPublish=task;
    void task.finally(()=>{if(inPublish===task)inPublish=null;});
  }
  function interrupted():void {
    if(state.phase!=='off'&&state.phase!=='stop-unconfirmed')void stop();
  }
  function accountChanged():void {interrupted();}
  function consentChanged(next:ShareRelation|null):void {
    const peer=state.peerUid,owner=p.ownerUid();
    if(peer&&(!owner||!next||!isEligibleToStart(next,owner,peer)))interrupted();
  }
  function disposedNow():void {
    disposed=true;
    // Best-effort, non-blocking remote stop; backend expiry is independent.
    void stop();
  }
  return Object.freeze({
    start,stop,retryStop,acknowledgeEmergencyStop,interrupted,accountChanged,consentChanged,
    dispose:disposedNow,getState:()=>state
  });
}
