/**
 * M2.4 draft STAGING HTTPS transport — integration contract ONLY, UNMOUNTED.
 * No service URL is configured and no app code imports this module. A reviewed
 * Cloud Run service + separate release gate are needed before real GPS writes.
 * All identity and foreground ports are injected; never accept tokens from UI.
 */
import type {SharePorts,ShareFix} from './m2ForegroundSession';
import type {M2FriendLocationTransport} from './M2FriendLocationPanel';

type AuthIdentity=Readonly<{uid:string;getIdToken:()=>Promise<string>}>;
type LocationTransportPorts=Readonly<{
  approvedCloudRunUrl:string;
  projectId:string;
  currentIdentity:()=>AuthIdentity|null;
  isForeground:()=>boolean;
  foregroundPermissionGranted:()=>Promise<boolean>;
  fetchImpl:typeof fetch;
  timeoutMs?:number;
  /** M3 Staging: reject same-account different-device publishing by capability. */
  useDeviceSessions?:boolean;
}>;
type LocationTransport=SharePorts['transport']&M2FriendLocationTransport&Readonly<{
  /** Explicit owner action, independent of this handset's session capability. */
  emergencyStop:(peerUid:string)=>Promise<{enabled:false}>;
  /** Read-only ephemeral capability for a matching authenticated M4 peer.
   * Never expose through UI text, storage or logs. */
  getPublisherSessionToken:(actorUid:string,peerUid:string)=>string|null;
}>;
const CODE=/^[A-Za-z0-9_-]{12,128}$/;
const fields=(obj:unknown,keys:readonly string[]):boolean=>{
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return false;
  const names=Object.keys(obj);
  return names.length===keys.length&&names.every(name=>keys.includes(name));
};
const unavailable=():never=>{throw Error('M2_LOCATION_TRANSPORT_UNAVAILABLE');};
const validNumber=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
// M3 v2 START issues a 60-second device capability, not a renewable bearer.
const MAX_V2_LEASE_MS=60_000;
/** Provider-confirmed Cloud Run origins in the one approved HereMate project.
 * Reject every other *.run.app host before Firebase bearer or GPS transfer. */
export const APPROVED_M2_STAGING_ORIGINS=Object.freeze([
  'https://heremate-m2-location-staging-976775896533.asia-southeast1.run.app',
  'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app'
]);
const validFix=(p:unknown):p is ShareFix=>{
  if(!fields(p,['latitude','longitude','accuracyMeters','capturedAtMs']))return false;
  const v=p as Record<string,unknown>;
  return validNumber(v.latitude)&&v.latitude>=-90&&v.latitude<=90&&
    validNumber(v.longitude)&&v.longitude>=-180&&v.longitude<=180&&
    validNumber(v.accuracyMeters)&&v.accuracyMeters>=0&&v.accuracyMeters<=200&&
    validNumber(v.capturedAtMs)&&Number.isSafeInteger(v.capturedAtMs);
};
function validUrl(input:string):string {
  let url:URL;
  try{url=new URL(input);}catch{return unavailable();}
  // Enforce the EXACT deployed project's reviewed Cloud Run origin.
  // A general *.run.app wildcard would exfiltrate bearer tokens and GPS
  // if an integration caller ever supplied its own Cloud Run service.
  if(url.protocol!=='https:'||!APPROVED_M2_STAGING_ORIGINS.includes(url.origin)||
     url.username||url.password||url.port||url.pathname!=='/'||
     url.search||url.hash||
     (input!==url.origin&&input!==url.origin+'/'))
    unavailable();
  return url.origin;
}
export function createM2StagingTransport(ports:LocationTransportPorts):LocationTransport {
  if(ports.projectId!=='heremate'||typeof ports.fetchImpl!=='function'||
     typeof ports.currentIdentity!=='function'||typeof ports.isForeground!=='function'||
     typeof ports.foregroundPermissionGranted!=='function')unavailable();
  const origin=validUrl(ports.approvedCloudRunUrl);
  const timeout=ports.timeoutMs??8000;
  if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>10000)unavailable();
  let deviceSession:{uid:string;peerUid:string;token:string;expiresAtMs:number}|null=null;
  // Do not let M4 issue a new evaluation while a v2 STOP is in flight.
  let deviceSessionStopPending=false;
  // A failed/timeout STOP is still an explicit owner withdrawal of consent.
  // Retain the opaque token solely for STOP retry; never resume GPS/M4 use.
  let deviceSessionStopIntent=false;
  // A user STOP in the sharing controller may need to await an in-flight
  // GPS publish BEFORE calling transport.stop(). Fence M4 borrowing and
  // further GPS synchronously at the original tap, not after that await.
  // Track STOP generations so a late START response cannot clear the intent.
  let deviceSessionStopGeneration=0;
  // A delayed first START must not allow another handset/session request to
  // race through this transport and overwrite its opaque publisher capability.
  let deviceSessionStartPending=false;
  // A user-initiated owner-wide STOP must wait for a pending START to settle:
  // otherwise a late START commit may recreate sharing after STOP was ACKed.
  let startSettled:Promise<void>|null=null;
  let emergencyStopPending=false;
  const validCapability=(value:unknown):value is string=>
    typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
  async function send(endpoint:string,payload:Readonly<Record<string,unknown>>,
    requireForeground:boolean):Promise<unknown> {
    const first=ports.currentIdentity();
    if(!first)throw Error('M2_LOCATION_TRANSPORT_UNAVAILABLE');
    if(!CODE.test(first.uid))unavailable();
    if(requireForeground&&(!ports.isForeground()||
       await ports.foregroundPermissionGranted()!==true))unavailable();
    // The OS permission check is async. Identity/foreground may have changed
    // silently before the Firebase auth/AppState callbacks are delivered.
    if(ports.currentIdentity()?.uid!==first.uid||
       (requireForeground&&!ports.isForeground()))unavailable();
    let jwt:string;
    try{jwt=await first.getIdToken();}
    catch{return unavailable();}
    if(typeof jwt!=='string'||jwt.length<32||jwt.length>8192)unavailable();
    if(ports.currentIdentity()?.uid!==first.uid)unavailable();
    if(requireForeground&&(!ports.isForeground()||
       await ports.foregroundPermissionGranted()!==true))unavailable();
    // Never send the captured bearer/GPS under a different live account or
    // after backgrounding while the final permission promise was pending.
    if(ports.currentIdentity()?.uid!==first.uid||
       (requireForeground&&!ports.isForeground()))unavailable();
    // Foreground/OS permission and Firebase token awaits can race an explicit
    // STOP or lease expiry. Never send a v2 GPS fix after STOP was requested,
    // even if the backend would reject the stale capability.
    if(endpoint==='/v2/locations/sessions/publish'){
      const lease=deviceSession;
      if(!lease||deviceSessionStopIntent||deviceSessionStopPending||emergencyStopPending||
         deviceSessionStartPending||lease.expiresAtMs<=Date.now()||
         lease.uid!==first.uid||lease.peerUid!==payload.viewerUid||
         lease.token!==payload.sessionToken)unavailable();
    }
    const body=JSON.stringify(payload);
    if(body.length>1024)unavailable();
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),timeout);
    try {
      const response=await ports.fetchImpl(origin+endpoint,{
        method:'POST',
        // A 307/308 redirect could forward a private GPS POST body to a
        // different origin even though the initial URL was allowlisted.
        redirect:'error',
        headers:{
          'Authorization':'Bearer '+jwt,
          'Content-Type':'application/json',
          'Accept':'application/json',
          'Cache-Control':'no-store'
        },
        body,signal:ctrl.signal
      });
      if(!response.ok||response.status!==200)unavailable();
      if(ports.currentIdentity()?.uid!==first.uid)unavailable();
      if(requireForeground&&!ports.isForeground())unavailable();
      let result:unknown;
      try{result=await response.json();}catch{return unavailable();}
      if(ports.currentIdentity()?.uid!==first.uid)unavailable();
      // A permission revocation DURING an HTTPS request must not deliver
      // any coordinate response to the UI after the original permission check.
      if(requireForeground&&(!ports.isForeground()||
         await ports.foregroundPermissionGranted()!==true))unavailable();
      // A late account/background transition during the final permission
      // await must not return another user's private response to the UI.
      if(ports.currentIdentity()?.uid!==first.uid||
         (requireForeground&&!ports.isForeground()))unavailable();
      return result;
    }catch{return unavailable();}
    finally{clearTimeout(timer);}
  }
  const safePeer=(peerUid:string)=>{
    if(!CODE.test(peerUid)||peerUid===ports.currentIdentity()?.uid)unavailable();
    return peerUid;
  };
  return Object.freeze({
    // Only v2's Firestore transaction validates the live grant on every
    // PUBLISH and atomically deletes it on STOP. Thus an already-sent late
    // PUBLISH cannot restore sharing after STOP commits. Legacy v1 remains
    // serialized behind in-flight publishes in the sharing controller.
    stopMayOvertakePublish:ports.useDeviceSessions===true,
    signalStopIntent(){
      // This is a local, non-network consent withdrawal. M2/v1 has no
      // publisher capability and retains its original STOP behavior.
      if(ports.useDeviceSessions!==true)return;
      deviceSessionStopGeneration++;
      deviceSessionStopIntent=true;
    },
    getPublisherSessionToken(actorUid:string,peerUid:string){
      const session=deviceSession;
      // Only this transport's live owner+peer may borrow the publisher
      // capability. Never return a token from a retired lease, during STOP,
      // emergency STOP, or when the handset is no longer in foreground.
      // Observing an account switch retires this in-memory lease even if
      // the original UID later signs back in (no same-UID resurrection).
      if(session&&session.uid!==ports.currentIdentity()?.uid){
        deviceSession=null;
        return null;
      }
      if(ports.useDeviceSessions!==true||!session||
         session.uid!==actorUid||!CODE.test(actorUid)||
         session.peerUid!==peerUid||!CODE.test(peerUid)||
         !ports.isForeground()||deviceSessionStopIntent||deviceSessionStopPending||
         emergencyStopPending||deviceSessionStartPending||
         !Number.isSafeInteger(session.expiresAtMs)||
         session.expiresAtMs<=Date.now())return null;
      return session.token;
    },
    async start(peerUid:string){
      const viewerUid=safePeer(peerUid);
      if(startSettled||emergencyStopPending)unavailable();
      // Acquire before any network await, including legacy v1 START.
      // This fence is shared by the explicit owner-wide emergency STOP.
      let resolveStart!:()=>void;
      const pending=new Promise<void>(resolve=>{resolveStart=resolve;});
      startSettled=pending;
      try {
      if(ports.useDeviceSessions===true){
        if(deviceSession!==null||deviceSessionStartPending)unavailable();
        const uid=ports.currentIdentity()?.uid;
        if(typeof uid!=='string')return unavailable();
        // Acquire synchronously before the first await; release on every
        // rejection, timeout or identity change without persisting a token.
        deviceSessionStartPending=true;
        const stopGenerationAtStart=deviceSessionStopGeneration;
        try {
          const result=await send('/v2/locations/sessions/start',{viewerUid},true);
          if(!fields(result,['enabled','expiresAtMs','sessionToken']))
            return unavailable();
          const row=result as {enabled:unknown;expiresAtMs:unknown;sessionToken:unknown};
          const expiry=row.expiresAtMs,token=row.sessionToken;
          if(row.enabled!==true||!validNumber(expiry)||
            !Number.isSafeInteger(expiry)||expiry<=Date.now()||
            expiry>Date.now()+MAX_V2_LEASE_MS||
            !validCapability(token)||ports.currentIdentity()?.uid!==uid)
            return unavailable();
          // A new explicit, server-confirmed START may replace a retired
          // account/lease; a failed STOP alone cannot clear the intent latch.
          // A STOP requested during an in-flight START must stay latched.
          // Only a separately initiated and confirmed START may retire an
          // older failed-STOP latch after the old lease was removed.
          if(stopGenerationAtStart===deviceSessionStopGeneration)
            deviceSessionStopIntent=false;
          deviceSession={uid,peerUid:viewerUid,token,expiresAtMs:expiry};
          return {enabled:true,expiresAtMs:expiry};
        } finally {
          deviceSessionStartPending=false;
        }
      }
      const result=await send('/v1/locations/grants/start',{viewerUid},true);
      if(!fields(result,['enabled','expiresAtMs']))unavailable();
      const grant=result as {enabled:unknown;expiresAtMs:unknown};
      const expiresAt=grant.expiresAtMs;
      if(grant.enabled!==true||!validNumber(expiresAt))
        throw Error('M2_LOCATION_TRANSPORT_UNAVAILABLE');
      return {enabled:true,expiresAtMs:expiresAt};
      } finally {
        if(startSettled===pending)startSettled=null;
        resolveStart();
      }
    },
    async stop(peerUid:string){
      const viewerUid=safePeer(peerUid);
      if(ports.useDeviceSessions===true){
        const active=deviceSession;
        if(!active||active.uid!==ports.currentIdentity()?.uid||
           active.peerUid!==viewerUid)return unavailable();
        if(deviceSessionStopPending)return unavailable();
        // Latch before the first network await. A timeout must not re-enable
        // sharing simply because the in-flight STOP flag was released.
        deviceSessionStopIntent=true;
        deviceSessionStopPending=true;
        try {
          const result=await send('/v2/locations/sessions/stop',{
            viewerUid,sessionToken:active.token
          },false);
          if(!fields(result,['enabled'])||
             (result as {enabled:unknown}).enabled!==false)unavailable();
          if(deviceSession?.token===active.token)deviceSession=null;
          deviceSessionStopIntent=false;
          return {enabled:false};
        } finally {
          deviceSessionStopPending=false;
        }
      }
      const result=await send('/v1/locations/grants/stop',{viewerUid},false);
      if(!fields(result,['enabled'])||(result as {enabled:unknown}).enabled!==false)unavailable();
      return {enabled:false};
    },
    async publish(peerUid:string,fix:ShareFix){
      if(!validFix(fix))unavailable();
      const viewerUid=safePeer(peerUid);
      const session=ports.useDeviceSessions===true?deviceSession:null;
      if(ports.useDeviceSessions===true&&
        (!session||session.uid!==ports.currentIdentity()?.uid||
          session.peerUid!==viewerUid||session.expiresAtMs<=Date.now()||
          deviceSessionStopIntent||deviceSessionStopPending||emergencyStopPending||
          deviceSessionStartPending))unavailable();
      const result=await send(ports.useDeviceSessions===true?
        '/v2/locations/sessions/publish':'/v1/locations/points/publish',{
        viewerUid,
        ...(session?{sessionToken:session.token}:{}),
        point:fix,appInForeground:true,foregroundPermissionGranted:true
      },true);
      // The HTTP publish may have been accepted BEFORE a user pressed STOP,
      // but a late ACK must never re-advertise active sharing in the UI.
      // Keep v1 unchanged and let independent STOP/emergency STOP finish.
      if(session&&(deviceSession?.token!==session.token||
         deviceSessionStopIntent||deviceSessionStopPending||emergencyStopPending||
         session.expiresAtMs<=Date.now()||
         ports.currentIdentity()?.uid!==session.uid||!ports.isForeground()))
        unavailable();
      if(!fields(result,['stored','expiresAtMs']))unavailable();
      const row=result as {stored:unknown;expiresAtMs:unknown};
      const expiresAt=row.expiresAtMs;
      if(row.stored!==true||!validNumber(expiresAt))
        throw Error('M2_LOCATION_TRANSPORT_UNAVAILABLE');
      return {stored:true,expiresAtMs:expiresAt};
    },
    async emergencyStop(peerUid:string){
      // User-initiated owner-wide STOP intentionally uses the stable v1 route:
      // any signed-in owner handset may revoke an otherwise inaccessible v2
      // session on a lost/other phone, without knowing that phone's capability.
      // Never infer success from a timeout or a rejected response.
      const viewerUid=safePeer(peerUid);
      if(emergencyStopPending)unavailable();
      const uid=ports.currentIdentity()?.uid;
      if(!uid)unavailable();
      // Block new STARTs immediately; then wait for any in-flight START
      // before issuing STOP. A confirmed STOP cannot race a late grant.
      emergencyStopPending=true;
      try {
        if(startSettled)await startSettled;
        if(ports.currentIdentity()?.uid!==uid)unavailable();
        if(deviceSession?.uid===uid&&deviceSession?.peerUid===viewerUid)
          deviceSessionStopIntent=true;
        const result=await send('/v1/locations/grants/stop',{viewerUid},false);
        if(!fields(result,['enabled'])||
           (result as {enabled:unknown}).enabled!==false||
           ports.currentIdentity()?.uid!==uid)unavailable();
        const active=deviceSession;
        if(active!==null&&active.uid===uid&&active.peerUid===viewerUid){
          deviceSession=null;
          deviceSessionStopIntent=false;
        }
        return {enabled:false as const};
      } finally {
        emergencyStopPending=false;
      }
    },
    async read(ownerUid:string){
      const result=await send('/v1/locations/points/read',{ownerUid:safePeer(ownerUid)},true);
      if(!fields(result,['point','expiresAtMs']))unavailable();
      const row=result as {point:unknown;expiresAtMs:unknown};
      if(!validFix(row.point)||!validNumber(row.expiresAtMs)||
        !Number.isSafeInteger(row.expiresAtMs))unavailable();
      return row as {point:ShareFix;expiresAtMs:number};
    }
  });
}
