/**
 * M4 staging, server-side pure geofence policy. Do NOT expose as a Cloud Run
 * route until full Auth/Firestore/notification security review and owner scope.
 * Never emits or persists GPS coordinates as an event/history record.
 */
export const MAX_ZONE_LIFETIME_MS=7*86_400_000;
export const PENDING_LIFETIME_MS=86_400_000;
export const EVENT_COOLDOWN_MS=300_000;
export const FIX_MAX_AGE_MS=30_000;
// Separate GPS observations must have fresh, increasing capture timestamps.
export const MIN_SAMPLE_SPACING_MS=1000;
export const MAX_CONSECUTIVE_SAMPLE_GAP_MS=30_000;
const isNum=n=>typeof n==='number'&&Number.isFinite(n);
const validClock=n=>Number.isSafeInteger(n)&&n>0;
const validCoord=(lat,lon)=>isNum(lat)&&lat>=-90&&lat<=90&&isNum(lon)&&lon>=-180&&lon<=180;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
export const validCircle=c=>exact(c,['latitude','longitude','radiusMeters'])&&
 validCoord(c.latitude,c.longitude)&&isNum(c.radiusMeters)&&
 c.radiusMeters>=100&&c.radiusMeters<=5000;
export const validFix=(fix,now)=>exact(fix,
 ['latitude','longitude','accuracyMeters','capturedAtMs'])&&
 validCoord(fix.latitude,fix.longitude)&&isNum(fix.accuracyMeters)&&
 fix.accuracyMeters>=0&&fix.accuracyMeters<=100&&validClock(fix.capturedAtMs)&&
 validClock(now)&&fix.capturedAtMs>=now-FIX_MAX_AGE_MS&&
 fix.capturedAtMs<=now+5000;
function radians(n){return n*Math.PI/180;}
export function distanceMeters(a,b){
 if(!validCoord(a?.latitude,a?.longitude)||!validCoord(b?.latitude,b?.longitude))return NaN;
 const dLat=radians(b.latitude-a.latitude),dLon=radians(b.longitude-a.longitude);
 const x=Math.sin(dLat/2)**2+Math.cos(radians(a.latitude))*
   Math.cos(radians(b.latitude))*Math.sin(dLon/2)**2;
 return 12_742_000*Math.asin(Math.sqrt(Math.max(0,Math.min(1,x))));
}
export const EMPTY_STATE=Object.freeze({zone:'unknown',pending:null,streak:0,
 lastEventAtMs:null,lastSampleCapturedAtMs:null});
export function advanceState(circle,fix,now,previous=EMPTY_STATE){
 if(!validCircle(circle)||!validFix(fix,now))return {next:EMPTY_STATE,event:null,quality:'invalid'};
 const zone=['inside','outside'].includes(previous?.zone)?previous.zone:'unknown';
 const lastEvent=validClock(previous?.lastEventAtMs)?previous.lastEventAtMs:null;
 const lastSample=validClock(previous?.lastSampleCapturedAtMs)?
   previous.lastSampleCapturedAtMs:null;
 const pending=['inside','outside'].includes(previous?.pending)?previous.pending:null;
 const streak=previous?.streak===1?1:0;
 // An identical, out-of-order or too-close fix must never count as the
 // second confirmation for Enter/Exit. Keep the previous state unchanged.
 // Only a capture timestamp is retained; never a coordinate, path or history.
 if(lastSample!==null&&fix.capturedAtMs-lastSample<MIN_SAMPLE_SPACING_MS)
   return {next:{zone,pending,streak,lastEventAtMs:lastEvent,
     lastSampleCapturedAtMs:lastSample},event:null,quality:'ambiguous'};
 const distance=distanceMeters(circle,fix);
 const observed=distance+fix.accuracyMeters<circle.radiusMeters?'inside':
   distance-fix.accuracyMeters>circle.radiusMeters?'outside':null;
 const nextSample=fix.capturedAtMs;
 if(!observed){
   return {next:{zone,pending:null,streak:0,lastEventAtMs:lastEvent,
     lastSampleCapturedAtMs:nextSample},event:null,quality:'ambiguous'};
 }
 if(observed===zone){
   return {next:{zone,pending:null,streak:0,lastEventAtMs:lastEvent,
     lastSampleCapturedAtMs:nextSample},event:null,quality:'ok'};
 }
 // A previous pending observation without a timestamp (older schema) is
 // never trusted as the first half of a fresh two-fix confirmation.
 const consecutive=lastSample!==null&&nextSample-lastSample<=
   MAX_CONSECUTIVE_SAMPLE_GAP_MS&&pending===observed&&streak===1;
 if(!consecutive)return {
   next:{zone,pending:observed,streak:1,lastEventAtMs:lastEvent,
     lastSampleCapturedAtMs:nextSample},event:null,quality:'ok'
 };
 // First two distinct, reliable samples establish a baseline only.
 if(zone==='unknown')return {
   next:{zone:observed,pending:null,streak:0,lastEventAtMs:lastEvent,
     lastSampleCapturedAtMs:nextSample},event:null,quality:'ok'
 };
 const emit=lastEvent===null||now-lastEvent>=EVENT_COOLDOWN_MS;
 return {
   next:{zone:observed,pending:null,streak:0,
     lastEventAtMs:emit?now:lastEvent,lastSampleCapturedAtMs:nextSample},
   event:emit?(observed==='inside'?'enter':'exit'):null,quality:'ok'
 };
}
