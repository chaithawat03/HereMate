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
export class GeofenceLimited extends Error{constructor(){super('too_many_requests');}}
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
// A stored M4 transition record is server-only but may be malformed after a
// partial migration or a previous write defect. Never let a corrupt cooldown
// or synthetic first-half sample turn ONE fresh fix into a false Enter/Exit.
// Old/expired approval state is intentionally reset to a new baseline.
function checkedDedupeState(state,owner,subject,revision,active,now){
 if(!state)return EMPTY_STATE;
 // Do not read or overwrite a different pair's colliding legacy document.
 if(state.ownerUid!==owner||state.subjectUid!==subject)deny();
 if(state.relationRevision!==revision||
    state.approvedAtMs!==active.approvedAtMs)return EMPTY_STATE;
 const expires=state.expiresAtMs;
 if(!Number.isSafeInteger(expires)||expires<=0||
    expires>active.expiresAtMs||expires>now+MAX_ZONE_LIFETIME_MS)deny();
 if(expires<=now)return EMPTY_STATE;
 const sample=state.lastSampleCapturedAtMs,event=state.lastEventAtMs;
 if(!['unknown','inside','outside'].includes(state.zone)||
    ![null,'inside','outside'].includes(state.pending)||
    (state.streak!==0&&state.streak!==1)||
    (state.pending===null)!==(state.streak===0)||
    (state.pending!==null&&state.pending===state.zone)||
    !(sample===null||(Number.isSafeInteger(sample)&&sample>0&&sample<=now+5000))||
    !(event===null||(Number.isSafeInteger(event)&&event>0&&event<=now))||
    (state.pending!==null&&sample===null))deny();
 return state;
}
export function createGeofenceService({adminAuth,store,rateLimiter,clock=Date.now}){
 if(adminAuth?.app?.options?.projectId!==STAGING_PROJECT||
    typeof adminAuth.verifyIdToken!=='function'||
    store?.projectId!==STAGING_PROJECT||
    typeof store.transactZone!=='function'||rateLimiter?.persistent!==true||
    typeof rateLimiter.consume!=='function'||typeof clock!=='function')
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
 async function limit(who,route){
   let accepted;
   try{accepted=await rateLimiter.consume({actor:who,route});}
   catch{throw new GeofenceBusy();}
   if(accepted!==true)throw new GeofenceLimited();
 }
 function tx(ownerUid,subjectUid,work){
   if(!goodUid(ownerUid)||!goodUid(subjectUid)||ownerUid===subjectUid)invalid();
   return store.transactZone({ownerUid,subjectUid},work);
 }
 return Object.freeze({
   async propose({idToken,subjectUid,circle}){
     const ownerUid=await actor(idToken);
     if(!validCircle(circle))invalid();
     await limit(ownerUid,'propose');
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
     await limit(subjectUid,'review');
     return tx(ownerUid,subjectUid,async ({relation,zone})=>{
       const now=clockNow(clock),revision=authorizeRelation(relation,ownerUid,subjectUid);
       const proposal=sameZone(zone,ownerUid,subjectUid,revision,now,'pending');
       // Subject must see the exact location/radius before accepting it.
       return {circle:{...proposal.circle},expiresAtMs:proposal.expiresAtMs,
         proposalCreatedAtMs:proposal.createdAtMs};
     });
   },
   async decide({idToken,ownerUid,approve,proposalCreatedAtMs}){
     const subjectUid=await actor(idToken);
     if(typeof approve!=='boolean'||!Number.isSafeInteger(proposalCreatedAtMs)||
        proposalCreatedAtMs<=0)invalid();
     await limit(subjectUid,'decide');
     return tx(ownerUid,subjectUid,async ({relation,zone,setZone,deleteZone,deleteState})=>{
       const now=clockNow(clock),revision=authorizeRelation(relation,ownerUid,subjectUid);
       const proposal=sameZone(zone,ownerUid,subjectUid,revision,now,'pending');
       // Never approve/reject a replacement circle that the subject did not
       // review. A new proposal can replace an expired one between requests.
       if(proposal.createdAtMs!==proposalCreatedAtMs)deny();
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
     return tx(ownerUid,subjectUid,async ({zone,state,deleteZone,deleteState})=>{
       // No relation/consent checks: a subject can ALWAYS revoke after
       // unfriending, even if the original grant is already gone.
       // Legacy Firestore pair IDs concatenate UIDs with "__", which is also
       // allowed inside Firebase UIDs. Distinct pairs can share a document
       // ID: never delete another pair's zone or dedupe state.
       if((zone&&(zone.ownerUid!==ownerUid||zone.subjectUid!==subjectUid))||
          (state&&(state.ownerUid!==ownerUid||state.subjectUid!==subjectUid)))deny();
       // Idempotent retries don't perform unnecessary Firestore writes.
       if(zone)deleteZone();
       if(state)deleteState();
       return {revoked:true};
     });
   },
   async evaluate({idToken,ownerUid,point,appInForeground,foregroundPermissionGranted}){
     const subjectUid=await actor(idToken);
     if(appInForeground!==true||foregroundPermissionGranted!==true)deny();
     const now=clockNow(clock);
     if(!validFix(point,now))invalid();
     await limit(subjectUid,'evaluate');
     return tx(ownerUid,subjectUid,async ({
       relation,zone,state,grant,publisher,setState,deleteState
     })=>{
       const current=clockNow(clock);
       const revision=authorizeRelation(relation,ownerUid,subjectUid);
       const active=sameZone(zone,ownerUid,subjectUid,revision,current,'active');
       activeM2Grant(grant,publisher,ownerUid,subjectUid,revision,current);
       if(!validFix(point,current))deny();
       // State is strictly zone-classification/dedupe. Never store GPS point.
       const previous=checkedDedupeState(
         state,ownerUid,subjectUid,revision,active,current);
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
