/**
 * M2.0 PRIVACY CONTRACT — pure, side-effect-free policy ONLY.
 * No Firebase SDK, GPS reader, network, React state, persistence or credentials.
 *
 * All backend inputs labeled "authoritative" MUST be freshly fetched and verified
 * server-side (verified Firebase ID token, Firestore M1 relationship and grant).
 * A client may call this for UI feedback, NEVER as the only authorization gate.
 */
export type GateReason =
  | 'not-authenticated' | 'self' | 'no-accepted-relationship'
  | 'not-mutually-consented' | 'share-off' | 'grant-expired'
  | 'not-foreground' | 'no-foreground-permission'
  | 'no-fresh-fix' | 'poor-accuracy';

export type GateDecision = Readonly<{allowed:boolean; reason:GateReason | 'allowed'}>;
export type TrustedRelation = Readonly<{
  senderUid:string;
  recipientUid:string;
  status:'pending'|'accepted'|'declined'|'cancelled'|'removed';
  senderConsent:boolean;
  recipientConsent:boolean;
}>;
export type TrustedShareGrant = Readonly<{
  ownerUid:string;
  enabled:boolean;
  expiresAtMs:number;
}>;
export type Fix = Readonly<{
  latitude:number;
  longitude:number;
  accuracyMeters:number;
  capturedAtMs:number;
}>;
export type PublishInput = Readonly<{
  authenticatedOwnerUid:string | null;
  ownerUid:string;
  viewerUid:string;
  relationship:TrustedRelation | null;
  grant:TrustedShareGrant | null;
  appInForeground:boolean;
  foregroundPermissionGranted:boolean;
  fix:Fix | null;
  nowMs:number;
}>;
export type ReadInput = Readonly<{
  authenticatedViewerUid:string | null;
  ownerUid:string;
  viewerUid:string;
  relationship:TrustedRelation | null;
  grant:TrustedShareGrant | null;
  fix:Fix | null;
  nowMs:number;
}>;

export const MAX_FIX_AGE_MS=30_000;
export const MAX_FIX_FUTURE_SKEW_MS=5_000;
export const MAX_ACCURACY_METERS=200;
export const MAX_SHARE_GRANT_LIFETIME_MS=5*60_000;

const deny=(reason:GateReason):GateDecision=>({allowed:false,reason});
const yes:GateDecision={allowed:true,reason:'allowed'};
const isUid=(v:unknown):v is string=>typeof v==='string' && /^[A-Za-z0-9_-]{12,128}$/.test(v);
const finite=(v:unknown):v is number=>typeof v==='number' && Number.isFinite(v);

function baseGate(
  ownerUid:string,viewerUid:string,
  relationship:TrustedRelation|null, grant:TrustedShareGrant|null, nowMs:number,
):GateDecision {
  if(!isUid(ownerUid) || !isUid(viewerUid) || !finite(nowMs))return deny('not-authenticated');
  if(ownerUid===viewerUid)return deny('self');
  if(!relationship || relationship.status!=='accepted' ||
     !isUid(relationship.senderUid) || !isUid(relationship.recipientUid) ||
     !((relationship.senderUid===ownerUid && relationship.recipientUid===viewerUid) ||
       (relationship.recipientUid===ownerUid && relationship.senderUid===viewerUid)))
    return deny('no-accepted-relationship');
  if(relationship.senderConsent!==true || relationship.recipientConsent!==true)
    return deny('not-mutually-consented');
  if(!grant || grant.ownerUid!==ownerUid || grant.enabled!==true)return deny('share-off');
  // Bound a grant to a short lifetime; a server-authoritative stop/revoke
  // must disable immediately, not wait for the expiry.
  if(!finite(grant.expiresAtMs) || grant.expiresAtMs<=nowMs ||
     grant.expiresAtMs>nowMs+MAX_SHARE_GRANT_LIFETIME_MS)
    return deny('grant-expired');
  return yes;
}

function fixGate(fix:Fix|null,nowMs:number):GateDecision {
  if(!fix ||
    !finite(fix.latitude) || fix.latitude< -90 || fix.latitude>90 ||
    !finite(fix.longitude) || fix.longitude< -180 || fix.longitude>180 ||
    !finite(fix.capturedAtMs) ||
    fix.capturedAtMs<nowMs-MAX_FIX_AGE_MS ||
    fix.capturedAtMs>nowMs+MAX_FIX_FUTURE_SKEW_MS)
    return deny('no-fresh-fix');
  if(!finite(fix.accuracyMeters) ||
     fix.accuracyMeters<0 || fix.accuracyMeters>MAX_ACCURACY_METERS)
    return deny('poor-accuracy');
  return yes;
}

/**
 * Server must re-read authoritative relation and grant on EVERY write.
 * Foreground/permission signals are additional client-side guards only;
 * no remote service can trust a client claim about current app foreground state.
 */
export function evaluatePublishGate(input:PublishInput):GateDecision {
  if(!isUid(input.authenticatedOwnerUid) || input.authenticatedOwnerUid!==input.ownerUid)
    return deny('not-authenticated');
  const base=baseGate(input.ownerUid,input.viewerUid,input.relationship,input.grant,input.nowMs);
  if(!base.allowed)return base;
  if(input.appInForeground!==true)return deny('not-foreground');
  if(input.foregroundPermissionGranted!==true)return deny('no-foreground-permission');
  return fixGate(input.fix,input.nowMs);
}

/** Server must re-read authoritative relation + grant on EVERY recipient request. */
export function evaluateReadGate(input:ReadInput):GateDecision {
  if(!isUid(input.authenticatedViewerUid) || input.authenticatedViewerUid!==input.viewerUid)
    return deny('not-authenticated');
  const base=baseGate(input.ownerUid,input.viewerUid,input.relationship,input.grant,input.nowMs);
  if(!base.allowed)return base;
  return fixGate(input.fix,input.nowMs);
}
