/**
 * M4 owner/subject two-stage consent, trusted Firebase Auth, M2 short-lived
 * grant/publisher and transactional geofence Enter/Exit. Dormant Staging
 * backend domain only: no deployed endpoints, no push or GPS history.
 */
import {
 MAX_ZONE_LIFETIME_MS,PENDING_LIFETIME_MS,validCircle,validFix,
 EMPTY_STATE,advanceState
} from './geofence-policy.mjs';
import {STAGING_PROJECT,UID_PATTERN} from '../location/location-service.mjs';
const deny=()=>{throw new GeofenceDenied();};
const invalid=()=>{throw new GeofenceInvalid();};
const isNum=n=>typeof n==='number'&&Number.isFinite(n);
const goodUid=x=>typeof x==='string'&&UID_PATTERN.test(x);
const clockNow=clock=>{
 const n=clock();
 if(!Number.isSafeInteger(n)||n<=0)throw new GeofenceBusy();
 return n;
};
export class GeofenceDenied extends Error{constructor(){super('not_available');}}
export class GeofenceInvalid extends Error{constructor(){super('invalid_request');}}
export class GeofenceBusy extends Error{constructor(){super('temporarily_unavailable');}}
function relationRevision(r){
 const ts=r?.updatedAt;
 if(!Number.isSafeInteger(ts?.seconds)||ts.seconds<0||
    !Number.isSafeInteger(ts?.nanoseconds)||ts.nanoseconds<0||
    ts.nanoseconds>=1_000_000_000)deny();
 return ts.seconds+':'+ts.nanoseconds;
}
function authorizeRelation(r,owner,subject){
 if(!r||r.status!=='accepted'||r.senderConsent!==true||
    r.recipientConsent!==true||
    !((r.senderUid===owner&&r.recipientUid===subject)||
      (r.senderUid===subject&&r.recipientUid===owner)))deny();
 return relationRevision(r);
}
function sameZone(zone,owner,subject,relation,now,status){
 if(!zone||zone.ownerUid!==owner||zone.subjectUid!==subject||
    zone.status!==status||zone.relationRevision!==relation||
    !Number.isSafeInteger(zone.expiresAtMs)||zone.expiresAtMs<=now||
    !validCircle(zone.circle))deny();
 return zone;
}
function activeM2Grant(grant,publisher,owner,subject,relation,now){
 // In the original M2 model, the tracked SUBJECT is the publisher/owner,
 // and the zone OWNER is the sole selected viewer.
 if(!grant||!publisher||grant.ownerUid!==subject||
    grant.viewerUid!==owner||grant.enabled!==true||
    grant.relationRevision!==relation||
    !Number.isSafeInteger(grant.expiresAtMs)||
    grant.expiresAtMs<=now||grant.expiresAtMs>now+60_000||
    publisher.ownerUid!==subject||publisher.viewerUid!==owner||
    publisher.expiresAtMs!==grant.expiresAtMs)deny();
}
export function createGeofenceService({adminAuth,store,clock=Date.now}){
 if(adminAuth?.app?.options?.projectId!==STAGING_PROJECT||
    typeof adminAuth.verifyIdToken!=='function'||
    store?.projectId!==STAGING_PROJECT||
    typeof store.transactZone!=='function'||typeof clock!=='function')
    throw new GeofenceBusy();
 async function actor(idToken){
   if(typeof idToken!=='string'||idToken.length<32||idToken.length>8192)deny();
   let claims;
   try{claims=await adminAuth.verifyIdToken(idToken,true);}catch{deny();}
   if(!goodUid(claims?.uid)||claims.sub!==claims.uid||
      claims.aud!==STAGING_PROJECT||
      claims.iss!=='https://securetoken.google.com/'+STAGING_PROJECT)deny();
   return claims.uid;
 }
 function tx(ownerUid,subjectUid,work){
   if(!goodUid(ownerUid)||!goodUid(subjectUid)||ownerUid===subjectUid)invalid();
   return store.transactZone({ownerUid,subjectUid},work);
 }
 return Object.freeze({
   async propose({idToken,subjectUid,circle}){
     const ownerUid=await actor(idToken);
     if(!validCircle(circle))invalid();
     return tx(ownerUid,subjectUid,async ({relation,zone,setZone,deleteState})=>{
       const now=clockNow(clock),revision=authorizeRelation(relation,ownerUid,subjectUid);
       // Each pair can have only one pending/active geofence, never parallel
       // duplicate records; a new proposal is never self-approved.
       if(zone && zone.expiresAtMs>now)deny();
       const expiresAtMs=now+PENDING_LIFETIME_MS;
       setZone({ownerUid,subjectUid,circle:{...circle},status:'pending',
         relationRevision:revision,createdAtMs:now,expiresAtMs,
         expireAt:new Date(expiresAtMs)});
       deleteState();
       return {proposed:true,expiresAtMs};
     });
   },
   async review({idToken,ownerUid}){
     const subjectUid=await actor(idToken);
     return tx(ownerUid,subjectUid,async ({relation,zone})=>{
       const now=clockNow(clock),revision=authorizeRelation(relation,ownerUid,subjectUid);
       const proposal=sameZone(zone,ownerUid,subjectUid,revision,now,'pending');
       // Subject must see the exact location/radius before accepting it.
       return {circle:{...proposal.circle},expiresAtMs:proposal.expiresAtMs};
     });
   },
   async decide({idToken,ownerUid,approve}){
     const subjectUid=await actor(idToken);
     if(typeof approve!=='boolean')invalid();
     return tx(ownerUid,subjectUid,async ({relation,zone,setZone,deleteZone,deleteState})=>{
       const now=clockNow(clock),revision=authorizeRelation(relation,ownerUid,subjectUid);
       const proposal=sameZone(zone,ownerUid,subjectUid,revision,now,'pending');
       deleteState();
       if(!approve){deleteZone();return {approved:false};}
       const expiresAtMs=now+MAX_ZONE_LIFETIME_MS;
       setZone({...proposal,status:'active',approvedAtMs:now,
         expiresAtMs,expireAt:new Date(expiresAtMs)});
       return {approved:true,expiresAtMs};
     });
   },
   async revoke({idToken,ownerUid,subjectUid}){
     const who=await actor(idToken);
     if(who!==ownerUid&&who!==subjectUid)deny();
     return tx(ownerUid,subjectUid,async ({deleteZone,deleteState})=>{
       // No relation/consent checks: a subject can ALWAYS revoke after
       // unfriending, even if the original grant is already gone.
       deleteZone();deleteState();
       return {revoked:true};
     });
   },
   async evaluate({idToken,ownerUid,point,appInForeground,foregroundPermissionGranted}){
     const subjectUid=await actor(idToken);
     if(appInForeground!==true||foregroundPermissionGranted!==true)deny();
     const now=clockNow(clock);
     if(!validFix(point,now))invalid();
     return tx(ownerUid,subjectUid,async ({
       relation,zone,state,grant,publisher,setState,deleteState
     })=>{
       const current=clockNow(clock);
       const revision=authorizeRelation(relation,ownerUid,subjectUid);
       const active=sameZone(zone,ownerUid,subjectUid,revision,current,'active');
       activeM2Grant(grant,publisher,ownerUid,subjectUid,revision,current);
       if(!validFix(point,current))deny();
       // State is strictly zone-classification/dedupe. Never store GPS point.
       const previous=state?.relationRevision===revision&&
          state?.approvedAtMs===active.approvedAtMs&&
          state.expiresAtMs>current?state:EMPTY_STATE;
       const {next,event,quality}=advanceState(active.circle,point,current,previous);
       if(quality==='invalid')deny();
       const expiresAtMs=Math.min(active.expiresAtMs,current+MAX_ZONE_LIFETIME_MS);
       setState({...next,ownerUid,subjectUid,relationRevision:revision,
         approvedAtMs:active.approvedAtMs,expiresAtMs,expireAt:new Date(expiresAtMs)});
       // Events returned ONLY to the authenticated tracked subject,
       // not stored as a location event/history, no push at this stage.
       return {evaluated:true,event,quality};
     });
   }
 });
}
