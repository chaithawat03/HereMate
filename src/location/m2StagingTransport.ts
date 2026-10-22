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
  async function send(endpoint:string,payload:Readonly<Record<string,unknown>>,
    requireForeground:boolean):Promise<unknown> {
    const first=ports.currentIdentity();
    if(!first||!CODE.test(first.uid))unavailable();
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
      const result=await send('/v1/locations/grants/start',{viewerUid:safePeer(peerUid)},true);
      if(!fields(result,['enabled','expiresAtMs']))unavailable();
      const grant=result as {enabled:unknown;expiresAtMs:unknown};
      if(grant.enabled!==true||!validNumber(grant.expiresAtMs))unavailable();
      return {enabled:true,expiresAtMs:grant.expiresAtMs};
    },
    async stop(peerUid:string){
      const result=await send('/v1/locations/grants/stop',{viewerUid:safePeer(peerUid)},false);
      if(!fields(result,['enabled'])||(result as {enabled:unknown}).enabled!==false)unavailable();
      return {enabled:false};
    },
    async publish(peerUid:string,fix:ShareFix){
      if(!fields(fix,['latitude','longitude','accuracyMeters','capturedAtMs']))unavailable();
      const result=await send('/v1/locations/points/publish',{
        viewerUid:safePeer(peerUid),point:fix,
        appInForeground:true,foregroundPermissionGranted:true
      },true);
      if(!fields(result,['stored','expiresAtMs']))unavailable();
      const row=result as {stored:unknown;expiresAtMs:unknown};
      if(row.stored!==true||!validNumber(row.expiresAtMs))unavailable();
      return {stored:true,expiresAtMs:row.expiresAtMs};
    },
    async read(ownerUid:string){
      const result=await send('/v1/locations/points/read',{ownerUid:safePeer(ownerUid)},true);
      if(!fields(result,['point','expiresAtMs'])||
         !fields((result as {point:unknown}).point,
           ['latitude','longitude','accuracyMeters','capturedAtMs']))unavailable();
      return result as {point:ShareFix;expiresAtMs:number};
    }
  });
}
