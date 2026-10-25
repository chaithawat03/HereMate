/**
 * M4 opt-in geofence transition CORE (offline, unmounted, NO notifications).
 *
 * A trusted backend would still have to load/verify current Firebase token,
 * exact accepted friendship, both M1 consent flags, short-lived M2 grant,
 * separate subject-specific geofence opt-in and own active publisher lease.
 * This pure evaluator DOES NOT authenticate callers, fetch location or persist
 * history/zone coordinates. Never use it as client-side authorization.
 */
import type {ShareRelation,ShareFix} from '../location/m2ForegroundSession';

export type GeofenceDefinition=Readonly<{
  id:string;ownerUid:string;subjectUid:string;
  latitude:number;longitude:number;radiusMeters:number;
  ownerOptIn:boolean;subjectOptIn:boolean;
  expiresAtMs:number;
}>;
export type GeofenceAccess=Readonly<{
  viewerUid:string;subjectUid:string;
  friendship:ShareRelation|null;
  /** True only if trusted backend has independently verified active M2 grant. */
  activeGrantVerified:boolean;
  grantExpiresAtMs:number;
  /** This phase deliberately rejects background location, even when OS permits it. */
  subjectInForeground:boolean;
}>;
export type GeofenceZone='unknown'|'inside'|'outside';
export type GeofenceState=Readonly<{
  zone:GeofenceZone;
  pending:'inside'|'outside'|null;
  streak:number;
  lastEventAtMs:number|null;
  /** Last accepted fix timestamp only; never persist coordinates or movement history. */
  lastSampleCapturedAtMs:number|null;
}>;
export type GeofenceSignal=Readonly<{
  state:GeofenceState;
  event:'enter'|'exit'|null;
  reason:'ok'|'blocked'|'ambiguous';
}>;
export const EMPTY_GEOFENCE_STATE:GeofenceState=Object.freeze({
  zone:'unknown',pending:null,streak:0,lastEventAtMs:null,
  lastSampleCapturedAtMs:null
});
export const GEOFENCE_EVENT_COOLDOWN_MS=5*60_000;
export const GEOFENCE_SAMPLE_MAX_AGE_MS=30_000;
// Match the dormant Staging server's anti-replay and long-gap baseline policy.
export const GEOFENCE_MIN_SAMPLE_SPACING_MS=1000;
export const GEOFENCE_MAX_CONSECUTIVE_SAMPLE_GAP_MS=30_000;
const UID=/^[A-Za-z0-9_-]{12,128}$/;
const ID=/^[A-Za-z0-9_-]{12,64}$/;
const valid=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const validTime=(n:unknown):n is number=>valid(n)&&Number.isSafeInteger(n);
const validPosition=(lat:unknown,lon:unknown):boolean=>
  valid(lat)&&lat>=-90&&lat<=90&&valid(lon)&&lon>=-180&&lon<=180;
const toRadians=(deg:number)=>deg*Math.PI/180;
const clamp=(n:number)=>Math.min(1,Math.max(0,n));
export function circleDistanceMeters(lat1:number,lon1:number,lat2:number,lon2:number){
  if(!validPosition(lat1,lon1)||!validPosition(lat2,lon2))return NaN;
  const deltaLat=toRadians(lat2-lat1);
  // atan/antimeridian safe because sin(x/2)^2 repeats every 2*PI.
  const deltaLon=toRadians(lon2-lon1);
  const a=Math.sin(deltaLat/2)**2+
    Math.cos(toRadians(lat1))*Math.cos(toRadians(lat2))*Math.sin(deltaLon/2)**2;
  return 6_371_000*2*Math.asin(Math.sqrt(clamp(a)));
}
export function eligibleGeofence(spec:GeofenceDefinition,access:GeofenceAccess,nowMs:number){
  if(!validTime(nowMs)||!ID.test(spec?.id??'')||
     !UID.test(spec?.ownerUid??'')||!UID.test(spec?.subjectUid??'')||
     spec.ownerUid===spec.subjectUid||
     spec.ownerUid!==access?.viewerUid||spec.subjectUid!==access?.subjectUid||
     spec.ownerOptIn!==true||spec.subjectOptIn!==true||
     access.activeGrantVerified!==true||access.subjectInForeground!==true||
     !validTime(access.grantExpiresAtMs)||
     access.grantExpiresAtMs<=nowMs||
     access.grantExpiresAtMs>nowMs+60_000||
     !validTime(spec.expiresAtMs)||spec.expiresAtMs<=nowMs||
     spec.expiresAtMs>nowMs+7*24*60*60_000||
     !validPosition(spec.latitude,spec.longitude)||
     !valid(spec.radiusMeters)||spec.radiusMeters<100||spec.radiusMeters>5000)
     return false;
  const r=access.friendship;
  return r?.status==='accepted'&&r.senderConsent===true&&r.recipientConsent===true&&
    ((r.senderUid===spec.ownerUid&&r.recipientUid===spec.subjectUid)||
     (r.recipientUid===spec.ownerUid&&r.senderUid===spec.subjectUid));
}
export function geofenceObservation(spec:GeofenceDefinition,fix:ShareFix,nowMs:number):
  'inside'|'outside'|'ambiguous'{
  if(!validTime(nowMs)||!validPosition(fix?.latitude,fix?.longitude)||
     !valid(fix.accuracyMeters)||fix.accuracyMeters<0||
     fix.accuracyMeters>100||
     !validTime(fix.capturedAtMs)||
     fix.capturedAtMs<nowMs-GEOFENCE_SAMPLE_MAX_AGE_MS||
     fix.capturedAtMs>nowMs+5000||
     !validPosition(spec?.latitude,spec?.longitude)||
     !valid(spec.radiusMeters)||spec.radiusMeters<100||spec.radiusMeters>5000)
    return 'ambiguous';
  const distance=circleDistanceMeters(
    spec.latitude,spec.longitude,fix.latitude,fix.longitude);
  if(distance+fix.accuracyMeters<spec.radiusMeters)return 'inside';
  if(distance-fix.accuracyMeters>spec.radiusMeters)return 'outside';
  return 'ambiguous';
}
export function stepGeofence(input:Readonly<{
  definition:GeofenceDefinition;
  access:GeofenceAccess;
  fix:ShareFix;
  nowMs:number;
  previous:GeofenceState;
}>):GeofenceSignal{
  if(!eligibleGeofence(input.definition,input.access,input.nowMs))
    return {state:EMPTY_GEOFENCE_STATE,event:null,reason:'blocked'};
  const prior=input.previous??EMPTY_GEOFENCE_STATE;
  const last=validTime(prior.lastEventAtMs)?prior.lastEventAtMs:null;
  const previousSample=validTime(prior.lastSampleCapturedAtMs)&&
    prior.lastSampleCapturedAtMs>0?prior.lastSampleCapturedAtMs:null;
  const sample=input.fix.capturedAtMs;
  const isValidSample=validTime(sample)&&sample>0&&
    sample>=input.nowMs-GEOFENCE_SAMPLE_MAX_AGE_MS&&
    sample<=input.nowMs+5000;
  // A suspended app or restored stale classification is not a live baseline.
  // The trusted Staging backend uses the same 30s continuity threshold.
  const gap=isValidSample&&previousSample!==null?
    sample-previousSample:Infinity;
  const stale=previousSample===null||
    gap>GEOFENCE_MAX_CONSECUTIVE_SAMPLE_GAP_MS;
  const zone=!stale&&(prior.zone==='inside'||prior.zone==='outside')?
    prior.zone:'unknown';
  const pending=!stale&&(prior.pending==='inside'||prior.pending==='outside')?
    prior.pending:null;
  const streak=!stale&&prior.streak===1?1:0;
  // Duplicate, older or too-close GPS callbacks must NOT satisfy the second
  // observation of a transition, even if the UI invokes evaluation twice.
  // Keep only one timestamp, never a GPS coordinate, route or event history.
  if(previousSample!==null&&isValidSample&&
     gap<GEOFENCE_MIN_SAMPLE_SPACING_MS)
    return {state:{zone,pending,streak,lastEventAtMs:last,
      lastSampleCapturedAtMs:previousSample},event:null,reason:'ambiguous'};
  const obs=geofenceObservation(input.definition,input.fix,input.nowMs);
  const nextSample=isValidSample?sample:previousSample;
  if(obs==='ambiguous')
    return {state:{zone,pending:null,streak:0,lastEventAtMs:last,
      lastSampleCapturedAtMs:nextSample},event:null,reason:'ambiguous'};
  if(zone===obs)
    return {state:{zone,pending:null,streak:0,lastEventAtMs:last,
      lastSampleCapturedAtMs:sample},event:null,reason:'ok'};
  const consecutive=previousSample!==null&&
    gap<=GEOFENCE_MAX_CONSECUTIVE_SAMPLE_GAP_MS&&
    pending===obs&&streak===1;
  if(!consecutive)
    return {state:{zone,pending:obs,streak:1,lastEventAtMs:last,
      lastSampleCapturedAtMs:sample},event:null,reason:'ok'};
  // Two distinct, recent fixes establish the initial baseline without alert.
  if(zone==='unknown')
    return {state:{zone:obs,pending:null,streak:0,lastEventAtMs:last,
      lastSampleCapturedAtMs:sample},event:null,reason:'ok'};
  const ready=last===null||input.nowMs-last>=GEOFENCE_EVENT_COOLDOWN_MS;
  return {state:{zone:obs,pending:null,streak:0,
    lastEventAtMs:ready?input.nowMs:last,
    lastSampleCapturedAtMs:sample},
    event:ready?(obs==='inside'?'enter':'exit'):null,
    reason:'ok'};
}
