/**
 * M2.3 REAL-friend location presentation contract (OFFLINE / UNMOUNTED).
 * Only responses obtained from the separately verified Staging Cloud Run API
 * may be supplied to this projection. Never query Firestore location docs.
 * No GPS writes, storage, background polling, logging or telemetry.
 */
import type {FriendRequest} from '../friends/friendModel';

export type RealFix=Readonly<{
  latitude:number;longitude:number;accuracyMeters:number;capturedAtMs:number;
}>;
export type ServerRead=Readonly<{point:RealFix;expiresAtMs:number}>;
export type LiveFriend=Readonly<{
  peerUid:string;displayName:string;point:RealFix;expiresAtMs:number;
}>;
export type PlotPin=Readonly<{
  peerUid:string;displayName:string;xPercent:number;yPercent:number;
  accuracyMeters:number;capturedAtMs:number;
}>;
export const MAX_VISIBLE_FIX_AGE_MS=30_000;
export const MAX_VISIBLE_ACCURACY_METERS=200;
export const MAX_MAP_FRIEND_READS=8;
const uid=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{12,128}$/.test(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const exact=(value:unknown,fields:readonly string[]):boolean=>{
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const keys=Object.keys(value);
  return keys.length===fields.length&&keys.every(k=>fields.includes(k));
};
function counterpart(relation:FriendRequest,viewerUid:string):{uid:string;name:string}|null {
  if(relation.status!=='accepted'||relation.senderConsent!==true||relation.recipientConsent!==true)
    return null;
  if(relation.senderUid===viewerUid&&uid(relation.recipientUid))
    return {uid:relation.recipientUid,name:relation.recipientDisplayName};
  if(relation.recipientUid===viewerUid&&uid(relation.senderUid))
    return {uid:relation.senderUid,name:relation.senderDisplayName};
  return null;
}

/** Always compare the current M1 relation before projecting any previously read point. */
export function authorizedPeers(viewerUid:string,relations:readonly FriendRequest[]):ReadonlyArray<{uid:string;name:string}> {
  if(!uid(viewerUid))return [];
  const peers=new Map<string,{uid:string;name:string;count:number}>();
  for(const row of relations){
    const other=counterpart(row,viewerUid);
    if(!other||other.uid===viewerUid)continue;
    const prior=peers.get(other.uid);
    peers.set(other.uid,{...other,count:(prior?.count??0)+1});
  }
  // Multiple directed records for the same pair are ambiguous, fail closed.
  return [...peers.values()].filter(p=>p.count===1).map(({uid,name})=>({uid,name}));
}

/** Returns null for absent, forged, expired, stale or inaccurate remote data. */
export function validatedRemoteFix(response:unknown,nowMs:number):ServerRead|null {
  if(!finite(nowMs)||!exact(response,['point','expiresAtMs']))return null;
  const result=response as {point:unknown;expiresAtMs:unknown};
  if(!exact(result.point,['latitude','longitude','accuracyMeters','capturedAtMs']))return null;
  const p=result.point as Record<string,unknown>,expiry=result.expiresAtMs;
  if(!finite(expiry)||expiry<=nowMs||expiry>nowMs+MAX_VISIBLE_FIX_AGE_MS)return null;
  if(!finite(p.latitude)||p.latitude< -90||p.latitude>90||
     !finite(p.longitude)||p.longitude< -180||p.longitude>180||
     !finite(p.accuracyMeters)||p.accuracyMeters<0||p.accuracyMeters>MAX_VISIBLE_ACCURACY_METERS||
     !finite(p.capturedAtMs)||p.capturedAtMs>nowMs+5000||
     p.capturedAtMs<nowMs-MAX_VISIBLE_FIX_AGE_MS)return null;
  return {expiresAtMs:expiry,point:{
    latitude:p.latitude,longitude:p.longitude,
    accuracyMeters:p.accuracyMeters,capturedAtMs:p.capturedAtMs
  }};
}

/** Maps ONLY current eligible friends to fresh points; never preserves hidden rows. */
export function visibleFriendLocations(input:Readonly<{
  viewerUid:string;relations:readonly FriendRequest[];
  reads:Readonly<Record<string,unknown>>;nowMs:number;
}>):LiveFriend[]{
  const allowed=authorizedPeers(input.viewerUid,input.relations);
  return allowed.flatMap(peer=>{
    const point=validatedRemoteFix(input.reads[peer.uid],input.nowMs);
    if(!point)return [];
    return [{peerUid:peer.uid,displayName:peer.name||peer.uid.slice(0,8),
      point:point.point,expiresAtMs:point.expiresAtMs}];
  });
}

/** Map status is a statement about visibility, NOT a claim about device presence.
 * OFFLINE is deliberately not inferred from missing points: the M2.1 API
 * exposes no trusted online/offline attestation. This model can add it only
 * after a separate authoritative presence service exists and is reviewed.
 */
export type FriendMapStatus='LIVE'|'STALE'|'SHARING_OFF'|'UNAVAILABLE';
export type FriendMapState=Readonly<{
  peerUid:string;displayName:string;status:FriendMapStatus;
}>;
export function friendMapStates(input:Readonly<{
  viewerUid:string;relations:readonly FriendRequest[];
  reads:Readonly<Record<string,unknown>>;nowMs:number;
}>):FriendMapState[]{
  if(!uid(input.viewerUid))return [];
  const unique=new Map<string,{name:string;status:FriendMapStatus;count:number}>();
  for(const relation of input.relations){
    if(relation.status!=='accepted')continue;
    let peerUid:string,displayName:string;
    if(relation.senderUid===input.viewerUid&&uid(relation.recipientUid)){
      peerUid=relation.recipientUid;displayName=relation.recipientDisplayName;
    }else if(relation.recipientUid===input.viewerUid&&uid(relation.senderUid)){
      peerUid=relation.senderUid;displayName=relation.senderDisplayName;
    }else continue;
    if(peerUid===input.viewerUid)continue;
    const mutual=relation.senderConsent===true&&relation.recipientConsent===true;
    const response=input.reads[peerUid];
    const valid=mutual?validatedRemoteFix(response,input.nowMs):null;
    // An expired response can be labelled stale but its coordinates may never
    // be plotted, nor revealed in marker labels or retained as a map pin.
    const expired=mutual&&!valid&&exact(response,['point','expiresAtMs'])&&
      finite((response as ServerRead).expiresAtMs)&&
      (response as ServerRead).expiresAtMs<=input.nowMs;
    const status:FriendMapStatus=!mutual?'SHARING_OFF':
      valid?'LIVE':expired?'STALE':'UNAVAILABLE';
    const prior=unique.get(peerUid);
    unique.set(peerUid,{
      name:displayName||peerUid.slice(0,8),status,count:(prior?.count??0)+1
    });
  }
  // Duplicate reciprocal records are ambiguous. Do not show even status.
  return [...unique.entries()].filter(([,row])=>row.count===1)
    .map(([peerUid,row])=>({peerUid,displayName:row.name,status:row.status}));
}

// Unwrap longitude around the first displayed point so ±180° does not produce
// a geographically inverted world-wide map span.
const unwrap=(lon:number,anchor:number)=>((lon-anchor+540)%360)-180;
const clamp=(x:number)=>Math.min(95,Math.max(5,x));

/**
 * Small schematic lat/lon plotting surface, NOT a street map or navigation
 * basemap. North is up. Coordinates are never returned in UI marker metadata.
 */
export function plotLiveFriends(friends:readonly LiveFriend[]):PlotPin[]{
  if(!friends.length)return [];
  const anchor=friends[0].point.longitude;
  const xs=friends.map(f=>unwrap(f.point.longitude,anchor));
  const ys=friends.map(f=>f.point.latitude);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const spanX=Math.max(maxX-minX,0.01),spanY=Math.max(maxY-minY,0.01);
  const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  return friends.map((f,i)=>({
    peerUid:f.peerUid,displayName:f.displayName,
    xPercent:clamp(50+80*(xs[i]-centerX)/spanX),
    yPercent:clamp(50-80*(ys[i]-centerY)/spanY),
    accuracyMeters:f.point.accuracyMeters,capturedAtMs:f.point.capturedAtMs
  }));
}
