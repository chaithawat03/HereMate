/**
 * M4 persistent per-actor/per-route abuse control, Firestore transaction-backed.
 * Never puts a raw Firebase UID or GPS coordinate in document keys.
 * Subject/owner REVOCATION is deliberately exempt: safety stop cannot be
 * locked out by rate exhaustion.
 * Not imported by any deployed Cloud Run runtime.
 */
import {createHash} from 'node:crypto';
import {STAGING_PROJECT,UID_PATTERN} from '../location/location-service.mjs';
import {GeofenceBusy} from './geofence-service.mjs';

export const GEOFENCE_WINDOW_MS=60_000;
export const GEOFENCE_ROUTE_LIMITS=Object.freeze({
  propose:4,review:12,decide:8,evaluate:12
});
const view=s=>s?.exists===true?s.data():null;
export function createFirestoreGeofenceRateLimiter(db,clock=Date.now){
  if(db?.projectId!==STAGING_PROJECT||typeof db.collection!=='function'||
     typeof db.runTransaction!=='function'||typeof clock!=='function')
     throw new GeofenceBusy();
  return Object.freeze({
    persistent:true,
    async consume({actor,route}){
      if(typeof actor!=='string'||!UID_PATTERN.test(actor)||
         !Object.hasOwn(GEOFENCE_ROUTE_LIMITS,route))throw new GeofenceBusy();
      const now=clock();
      if(!Number.isSafeInteger(now)||now<=0)throw new GeofenceBusy();
      const hash=createHash('sha256').update('m4-geofence:v1:'+route+':'+actor).digest('hex');
      const ref=db.collection('private_geofence_rate_limits').doc(hash);
      return db.runTransaction(async tx=>{
        const snap=await tx.get(ref),row=view(snap);
        if(row&&(!Number.isSafeInteger(row.count)||row.count<1||
           !Number.isSafeInteger(row.windowStartedAtMs)||
           row.windowStartedAtMs>now))throw new GeofenceBusy();
        const active=!!row&&now-row.windowStartedAtMs<GEOFENCE_WINDOW_MS;
        const count=active?row.count:0;
        if(count>=GEOFENCE_ROUTE_LIMITS[route])return false;
        const start=active?row.windowStartedAtMs:now;
        tx.set(ref,{count:count+1,windowStartedAtMs:start,
          expireAt:new Date(start+GEOFENCE_WINDOW_MS+86_400_000)});
        return true;
      });
    }
  });
}
