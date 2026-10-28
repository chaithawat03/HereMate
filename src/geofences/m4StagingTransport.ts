/**
 * HereMate M4 consented-geofence HTTPS transport for future STAGING enablement.
 * No mobile entry point enables M4 by default. Server retains sole authority
 * to authenticate, check accepted friendship/dual consent, subject approval,
 * M2 publisher grant and authorization on EVERY request.
 * No GPS history, background tasks, push tokens or local coordinate storage.
 */
import type {ShareFix} from '../location/m2ForegroundSession';

export type GeofenceCircle=Readonly<{
 latitude:number;longitude:number;radiusMeters:number;
}>;
export type GeofenceOutcome=Readonly<{
 evaluated:true;event:'enter'|'exit'|null;quality:'ok'|'ambiguous';
}>;
type Identity=Readonly<{uid:string;getIdToken:()=>Promise<string>}>;
export type M4TransportPorts=Readonly<{
 approvedCloudRunUrl:string;projectId:string;
 currentIdentity:()=>Identity|null;
 isForeground:()=>boolean;
 foregroundPermissionGranted:()=>Promise<boolean>;
 fetchImpl:typeof fetch;timeoutMs?:number;
}>;
export type M4Transport=Readonly<{
 propose:(subjectUid:string,circle:GeofenceCircle)=>Promise<{proposed:true;expiresAtMs:number}>;
 review:(ownerUid:string)=>Promise<{
  circle:GeofenceCircle;expiresAtMs:number;proposalCreatedAtMs:number;
 }>;
 decide:(ownerUid:string,approve:boolean,proposalCreatedAtMs:number)=>
  Promise<{approved:boolean;expiresAtMs?:number}>;
 revoke:(ownerUid:string,subjectUid:string)=>Promise<{revoked:true}>;
 evaluate:(ownerUid:string,point:ShareFix)=>Promise<GeofenceOutcome>;
}>;
// Exact provider-observed origins for the single, owner-reviewed M2 Cloud Run
// service. The five M4 routes are NOT deployed there today.
export const APPROVED_M4_STAGING_ORIGINS=Object.freeze([
 'https://heremate-m2-location-staging-976775896533.asia-southeast1.run.app',
 'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app'
]);
const CODE=/^[A-Za-z0-9_-]{12,128}$/;
const number=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const own=(x:unknown,fields:readonly string[])=>{
 if(!x||typeof x!=='object'||Array.isArray(x))return false;
 const keys=Object.keys(x);
 return keys.length===fields.length&&keys.every(k=>fields.includes(k));
};
const unavailable=():never=>{throw Error('M4_GEOFENCE_NOT_AVAILABLE');};
function validCircle(value:unknown):value is GeofenceCircle{
 if(!own(value,['latitude','longitude','radiusMeters']))return false;
 const c=value as GeofenceCircle;
 return number(c.latitude)&&c.latitude>=-90&&c.latitude<=90&&
   number(c.longitude)&&c.longitude>=-180&&c.longitude<=180&&
   number(c.radiusMeters)&&c.radiusMeters>=100&&c.radiusMeters<=5000;
}
function validFix(value:unknown):value is ShareFix{
 if(!own(value,['latitude','longitude','accuracyMeters','capturedAtMs']))return false;
 const p=value as ShareFix;
 return number(p.latitude)&&p.latitude>=-90&&p.latitude<=90&&
   number(p.longitude)&&p.longitude>=-180&&p.longitude<=180&&
   number(p.accuracyMeters)&&p.accuracyMeters>=0&&p.accuracyMeters<=100&&
   number(p.capturedAtMs)&&Number.isSafeInteger(p.capturedAtMs)&&
   p.capturedAtMs>=Date.now()-30_000&&p.capturedAtMs<=Date.now()+5000;
}
function exactOrigin(input:string){
 if(!APPROVED_M4_STAGING_ORIGINS.includes(input))return unavailable();
 let url:URL;
 try{url=new URL(input);}catch{return unavailable();}
 if(url.origin!==input||url.protocol!=='https:'||url.username||url.password||
    url.port||url.pathname!=='/'||url.search||url.hash)return unavailable();
 return url.origin;
}
export function createM4StagingTransport(ports:M4TransportPorts):M4Transport{
 if(ports.projectId!=='heremate'||typeof ports.currentIdentity!=='function'||
    typeof ports.isForeground!=='function'||
    typeof ports.foregroundPermissionGranted!=='function'||
    typeof ports.fetchImpl!=='function')return unavailable();
 const origin=exactOrigin(ports.approvedCloudRunUrl);
 const timeout=ports.timeoutMs??8000;
 if(!Number.isSafeInteger(timeout)||timeout<1000||timeout>10_000)return unavailable();
 const peer=(uid:string)=>{
   if(!CODE.test(uid)||uid===ports.currentIdentity()?.uid)return unavailable();
   return uid;
 };
 async function send(endpoint:string,body:Record<string,unknown>,requireGps:boolean){
   // The deadline starts BEFORE any asynchronous OS permission or Firebase
   // token retrieval. A hung preflight must not hold the UI's revoke mutex
   // indefinitely or issue a late private GPS/zone POST after expiry.
   const controller=new AbortController();
   let rejectDeadline!:(reason:Error)=>void;
   const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
   const timer=setTimeout(()=>{
     controller.abort();
     rejectDeadline(Error('M4_GEOFENCE_REQUEST_EXPIRED'));
   },timeout);
   const within=<T>(pending:Promise<T>):Promise<T>=>
     Promise.race([pending,deadline]);
   try{
   const actor=ports.currentIdentity();
   if(!actor||!CODE.test(actor.uid)||!ports.isForeground())return unavailable();
   if(requireGps&&!(await within(ports.foregroundPermissionGranted())))return unavailable();
   // An OS permission promise can settle after a silent auth/background
   // change, before Firebase/AppState listeners invalidate the UI.
   if(ports.currentIdentity()!==actor||!ports.isForeground())return unavailable();
   let jwt:string;
   try{jwt=await within(actor.getIdToken());}catch{return unavailable();}
   if(typeof jwt!=='string'||jwt.length<32||jwt.length>8192||jwt.includes('\n')||
      ports.currentIdentity()!==actor||!ports.isForeground())return unavailable();
   if(requireGps&&!(await within(ports.foregroundPermissionGranted())))return unavailable();
   // Do not transmit the original subject's GPS with a stale Firebase bearer.
   if(ports.currentIdentity()!==actor||!ports.isForeground())return unavailable();
   const json=JSON.stringify(body);
   if(json.length>2048)return unavailable();
   try{
     const res=await within(ports.fetchImpl(origin+endpoint,{
       method:'POST',
       // Prevent 307/308 redirects forwarding private zone coordinates, GPS
       // and authenticated POST data outside this exact Staging origin.
       redirect:'error',
       headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json',
         Accept:'application/json','Cache-Control':'no-store'},
       body:json,signal:controller.signal
     }));
     if(res.status!==200||!res.ok||ports.currentIdentity()!==actor||
        !ports.isForeground())return unavailable();
     let value:unknown;
     try{value=await within(res.json());}catch{return unavailable();}
     if(ports.currentIdentity()!==actor||!ports.isForeground())return unavailable();
     if(requireGps&&!(await within(ports.foregroundPermissionGranted())))return unavailable();
     // Do not expose the server-confirmed event if the final OS permission
     // await completed after logout, account switch or app background.
     if(ports.currentIdentity()!==actor||!ports.isForeground())return unavailable();
     return value;
   }catch{return unavailable();}
   }catch{
     // Never expose native/Firebase timeout details or partially confirmed
     // private geofence state through the public transport error contract.
     return unavailable();
   }finally{clearTimeout(timer);}
 }
 return Object.freeze({
   async propose(subjectUid,circle){
     if(!validCircle(circle))return unavailable();
     const row=await send('/v1/geofences/propose',{subjectUid:peer(subjectUid),circle},false);
     if(!own(row,['proposed','expiresAtMs'])||
       (row as {proposed:unknown}).proposed!==true||
       !number((row as {expiresAtMs:unknown}).expiresAtMs))return unavailable();
     return row as {proposed:true;expiresAtMs:number};
   },
   async review(ownerUid){
     const row=await send('/v1/geofences/review',{ownerUid:peer(ownerUid)},false);
     if(!own(row,['circle','expiresAtMs','proposalCreatedAtMs'])||
       !validCircle((row as {circle:unknown}).circle)||
       !number((row as {expiresAtMs:unknown}).expiresAtMs)||
       !Number.isSafeInteger((row as {proposalCreatedAtMs:unknown}).proposalCreatedAtMs)||
       (row as {proposalCreatedAtMs:number}).proposalCreatedAtMs<=0)return unavailable();
     return row as {circle:GeofenceCircle;expiresAtMs:number;proposalCreatedAtMs:number};
   },
   async decide(ownerUid,approve,proposalCreatedAtMs){
     if(typeof approve!=='boolean'||!Number.isSafeInteger(proposalCreatedAtMs)||
        proposalCreatedAtMs<=0)return unavailable();
     const row=await send('/v1/geofences/decide',{
       ownerUid:peer(ownerUid),approve,proposalCreatedAtMs
     },false);
     if(approve){
       if(!own(row,['approved','expiresAtMs'])||
          (row as {approved:unknown}).approved!==true||
          !number((row as {expiresAtMs:unknown}).expiresAtMs))return unavailable();
       return row as {approved:true;expiresAtMs:number};
     }
     if(!own(row,['approved'])||(row as {approved:unknown}).approved!==false)return unavailable();
     return {approved:false};
   },
   async revoke(ownerUid,subjectUid){
     const user=ports.currentIdentity()?.uid;
     if(!user||(user!==ownerUid&&user!==subjectUid))return unavailable();
     const other=user===ownerUid?subjectUid:ownerUid;
     peer(other);
     const row=await send('/v1/geofences/revoke',{ownerUid,subjectUid},false);
     if(!own(row,['revoked'])||(row as {revoked:unknown}).revoked!==true)return unavailable();
     return {revoked:true};
   },
   async evaluate(ownerUid,point){
     if(!validFix(point))return unavailable();
     const row=await send('/v1/geofences/evaluate',{
       ownerUid:peer(ownerUid),point,appInForeground:true,
       foregroundPermissionGranted:true
     },true);
     if(!own(row,['evaluated','event','quality']))return unavailable();
     const data=row as {evaluated:unknown;event:unknown;quality:unknown};
     if(data.evaluated!==true||
        ![null,'enter','exit'].includes(data.event as string|null)||
        !['ok','ambiguous'].includes(data.quality as string))return unavailable();
     return data as GeofenceOutcome;
   }
 });
}
