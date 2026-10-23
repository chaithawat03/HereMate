/**
 * Firestore Admin implementation for server-only M4 zone + transition state.
 * No direct SDK clients may access these documents (wildcard Rules deny).
 * Each call reads both directed friend relations, geofence, state, and
 * M2 publisher/grant atomically before writing. No GPS coordinate is stored
 * in state or returned as an event payload.
 */
import {STAGING_PROJECT,UID_PATTERN} from '../location/location-service.mjs';
import {GeofenceBusy} from './geofence-service.mjs';
const view=s=>s?.exists===true?s.data():null;
export function createFirestoreGeofenceStore(db){
 if(db?.projectId!==STAGING_PROJECT||typeof db.collection!=='function'||
    typeof db.runTransaction!=='function')throw new GeofenceBusy();
 return Object.freeze({
   projectId:STAGING_PROJECT,
   async transactZone({ownerUid,subjectUid},work){
     if(!UID_PATTERN.test(ownerUid||'')||!UID_PATTERN.test(subjectUid||'')||
        ownerUid===subjectUid||typeof work!=='function')throw new GeofenceBusy();
     const pair=ownerUid+'__'+subjectUid;
     const doc=(col,id)=>db.collection(col).doc(id);
     const refs=[
       doc('friendRequests',pair),doc('friendRequests',subjectUid+'__'+ownerUid),
       doc('private_geofence_zones',pair),doc('private_geofence_states',pair),
       doc('private_location_grants',subjectUid+'__'+ownerUid),
       doc('private_location_publishers',subjectUid)
     ];
     return db.runTransaction(async tx=>{
       const [forward,back,zone,state,grant,publisher]=
         await Promise.all(refs.map(ref=>tx.get(ref)));
       const relations=[view(forward),view(back)].filter(Boolean);
       const relation=relations.length===1?relations[0]:null;
       const pending=[];
       const result=await work({
         relation,zone:view(zone),state:view(state),
         grant:view(grant),publisher:view(publisher),
         setZone:value=>pending.push(['set',refs[2],value]),
         deleteZone:()=>pending.push(['delete',refs[2]]),
         setState:value=>pending.push(['set',refs[3],value]),
         deleteState:()=>pending.push(['delete',refs[3]])
       });
       // Firestore transactions require reads before any writes.
       for(const [op,ref,value] of pending){
         if(op==='set')tx.set(ref,value);
         else tx.delete(ref);
       }
       return result;
     });
   }
 });
}
