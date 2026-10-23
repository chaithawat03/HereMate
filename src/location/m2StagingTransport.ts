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
type LocationTransport=SharePorts['transport']&M2FriendLocationTransport;
const CODE=/^[A-Za-z0-9_-]{12,128}$/;
const fields=(obj:unknown,keys:readonly string[]):boolean=>{
  if(!obj||typeof obj!=='object'||Array.isArray(obj))return false;
  const names=Object.keys(obj);
  return names.length===keys.length&&names.every(name=>keys.includes(name));
};
const unavailable=():never=>{throw Error('M2_LOCATION_TRANSPORT_UNAVAILABLE');};
const validNumber=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
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
  // No developer tunnel, arbitrary host, IP, plain HTTP or URL credentials.
  if(url.protocol!=='https:'||!url.hostname.endsWith('.run.app')||
    url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)
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
  let deviceSession:{uid:string;peerUid:string;token:string}|null=null;
  const validCapability=(value:unknown):value is string=>
    typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
  async function send(endpoint:string,payload:Readonly<Record<string,unknown>>,
    requireForeground:boolean):Promise<unknown> {
    const first=ports.currentIdentity();
    if(!first)throw Error('M2_LOCATION_TRANSPORT_UNAVAILABLE');
    if(!CODE.test(first.uid))unavailable();
    if(requireForeground&&(!ports.isForeground()||
       await ports.foregroundPermissionGranted()!==true))unavailable();
    let jwt:string;
    try{jwt=await first.getIdToken();}
    catch{return unavailable();}
    if(typeof jwt!=='string'||jwt.length<32||jwt.length>8192)unavailable();
    if(ports.currentIdentity()?.uid!==first.uid)unavailable();
    if(requireForeground&&(!ports.isForeground()||
       await ports.foregroundPermissionGranted()!==true))unavailable();
    const body=JSON.stringify(payload);
    if(body.length>1024)unavailable();
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),timeout);
    try {
      const response=await ports.fetchImpl(origin+endpoint,{
        method:'POST',
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
      return result;
    }catch{return unavailable();}
    finally{clearTimeout(timer);}
  }
  const safePeer=(peerUid:string)=>{
    if(!CODE.test(peerUid)||peerUid===ports.currentIdentity()?.uid)unavailable();
    return peerUid;
  };
  return Object.freeze({
    async start(peerUid:string){
      const viewerUid=safePeer(peerUid);
      if(ports.useDeviceSessions===true){
        if(deviceSession!==null)unavailable();
        const uid=ports.currentIdentity()?.uid;
        if(!uid)unavailable();
        const result=await send('/v2/locations/sessions/start',{viewerUid},true);
        if(!fields(result,['enabled','expiresAtMs','sessionToken']))unavailable();
        const row=result as {enabled:unknown;expiresAtMs:unknown;sessionToken:unknown};
        if(row.enabled!==true||!validNumber(row.expiresAtMs)||
          !validCapability(row.sessionToken)||
          ports.currentIdentity()?.uid!==uid)unavailable();
        deviceSession={uid,peerUid:viewerUid,token:row.sessionToken};
        return {enabled:true,expiresAtMs:row.expiresAtMs};
      }
      const result=await send('/v1/locations/grants/start',{viewerUid},true);
      if(!fields(result,['enabled','expiresAtMs']))unavailable();
      const grant=result as {enabled:unknown;expiresAtMs:unknown};
      const expiresAt=grant.expiresAtMs;
      if(grant.enabled!==true||!validNumber(expiresAt))
        throw Error('M2_LOCATION_TRANSPORT_UNAVAILABLE');
      return {enabled:true,expiresAtMs:expiresAt};
    },
    async stop(peerUid:string){
      const viewerUid=safePeer(peerUid);
      if(ports.useDeviceSessions===true){
        const active=deviceSession;
        if(!active||active.uid!==ports.currentIdentity()?.uid||
           active.peerUid!==viewerUid)unavailable();
        const result=await send('/v2/locations/sessions/stop',{
          viewerUid,sessionToken:active.token
        },false);
        if(!fields(result,['enabled'])||
           (result as {enabled:unknown}).enabled!==false)unavailable();
        if(deviceSession?.token===active.token)deviceSession=null;
        return {enabled:false};
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
          session.peerUid!==viewerUid))unavailable();
      const result=await send(ports.useDeviceSessions===true?
        '/v2/locations/sessions/publish':'/v1/locations/points/publish',{
        viewerUid,
        ...(session?{sessionToken:session.token}:{}),
        point:fix,appInForeground:true,foregroundPermissionGranted:true
      },true);
      if(session&&deviceSession?.token!==session.token)unavailable();
      if(!fields(result,['stored','expiresAtMs']))unavailable();
      const row=result as {stored:unknown;expiresAtMs:unknown};
      const expiresAt=row.expiresAtMs;
      if(row.stored!==true||!validNumber(expiresAt))
        throw Error('M2_LOCATION_TRANSPORT_UNAVAILABLE');
      return {stored:true,expiresAtMs:expiresAt};
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
