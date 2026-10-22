/**
 * M2.1 Firestore Admin SDK adapter contract. Separate data-plane collections
 * remain DENIED to all client SDKs by the current wildcard Firestore rules.
 * No SDK initialization/credentials or service deployment in this module.
 */
import {createHash} from 'node:crypto';
import {LocationBusy,STAGING_PROJECT,UID_PATTERN} from './location-service.mjs';

const WINDOW_MS=60_000;
const ROUTE_LIMITS=Object.freeze({start:6,stop:30,publish:12,read:30});
function requiredFirestore(db) {
  if(db?.projectId!==STAGING_PROJECT||
     typeof db.collection!=='function'||typeof db.runTransaction!=='function')
    throw new LocationBusy();
}
const doc=(db,name,id)=>db.collection(name).doc(id);
const safeUid=u=>UID_PATTERN.test(u||'');
const view=snap=>snap?.exists===true?snap.data():null;

export function createFirestoreLocationStore(db) {
  requiredFirestore(db);
  return Object.freeze({
    projectId:STAGING_PROJECT,
    async transactPair({ownerUid,viewerUid},work) {
      if(!safeUid(ownerUid)||!safeUid(viewerUid)||ownerUid===viewerUid||
         typeof work!=='function')throw new LocationBusy();
      const pair=ownerUid+'__'+viewerUid;
      const refs=[
        doc(db,'friendRequests',pair),
        doc(db,'friendRequests',viewerUid+'__'+ownerUid),
        doc(db,'private_location_grants',pair),
        doc(db,'private_latest_locations',pair),
        doc(db,'private_location_publishers',ownerUid),
      ];
      return db.runTransaction(async tx=>{
        // Firestore transactions require ALL reads before ANY writes.
        // Concurrent M1 acceptance/consent/removal updates cause a retry.
        const [forward,reverse,grant,point,publisher]=await Promise.all(refs.map(x=>tx.get(x)));
        const relevant=[view(forward),view(reverse)].filter(Boolean);
        // Ambiguous bidirectional relationship records are denied, never merged.
        const relation=relevant.length===1?relevant[0]:null;
        const changes=[];
        const outcome=await work({
          relation,grant:view(grant),point:view(point),publisher:view(publisher),
          setPublisher:data=>changes.push(['set',refs[4],data]),
          deletePublisher:()=>changes.push(['delete',refs[4]]),
          setGrant:data=>changes.push(['set',refs[2],data]),
          deleteGrant:()=>changes.push(['delete',refs[2]]),
          setPoint:data=>changes.push(['set',refs[3],data]),
          deletePoint:()=>changes.push(['delete',refs[3]])
        });
        for(const [action,ref,data] of changes){
          if(action==='set')tx.set(ref,data);
          else tx.delete(ref);
        }
        return outcome;
      });
    }
  });
}
export function createFirestoreLocationRateLimiter(db,clock=Date.now) {
  requiredFirestore(db);
  if(typeof clock!=='function')throw new LocationBusy();
  return Object.freeze({
    persistent:true,
    async consume({actor,route}) {
      if(!safeUid(actor)||!Object.hasOwn(ROUTE_LIMITS,route))throw new LocationBusy();
      const now=clock();
      if(!Number.isSafeInteger(now)||now<=0)throw new LocationBusy();
      // No raw UID in rate-limit document IDs.
      const key=createHash('sha256').update('m2-location:v1:'+route+':'+actor).digest('hex');
      const ref=doc(db,'private_location_rate_limits',key);
      return db.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        const row=view(snap);
        if(row && (!Number.isSafeInteger(row.windowStartedAtMs)||
           !Number.isSafeInteger(row.count)||row.count<1||
           row.windowStartedAtMs>now))throw new LocationBusy();
        const active=row && now-row.windowStartedAtMs<WINDOW_MS;
        const count=active?row.count:0;
        if(count>=ROUTE_LIMITS[route])return false;
        const start=active?row.windowStartedAtMs:now;
        tx.set(ref,{count:count+1,windowStartedAtMs:start,
          expireAt:new Date(start+WINDOW_MS+86_400_000)});
        return true;
      });
    }
  });
}
