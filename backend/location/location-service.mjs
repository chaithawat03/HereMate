/**
 * M2.1 Staging location API DOMAIN — NOT deployed or imported by Android.
 * Verified Firebase ID token + atomic Firestore data from trusted adapters only.
 * No Firebase credentials, coordinates or tokens are ever logged.
 */
export const STAGING_PROJECT = 'heremate';
export const UID_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;
export const GRANT_MS = 60_000;
export const FIX_MAX_AGE_MS = 30_000;
export const FIX_FUTURE_SKEW_MS = 5_000;
export const ACCURACY_MAX_M = 200;
const pointFields = ['latitude','longitude','accuracyMeters','capturedAtMs'];

export class LocationDenied extends Error {
  constructor(){super('not_authorized');this.code='LOCATION_DENIED';}
}
export class LocationInvalid extends Error {
  constructor(){super('invalid_request');this.code='LOCATION_INVALID';}
}
export class LocationBusy extends Error {
  constructor(){super('temporarily_unavailable');this.code='LOCATION_BUSY';}
}
export class LocationLimited extends Error {
  constructor(){super('too_many_requests');this.code='LOCATION_LIMITED';}
}
const uid = s=>typeof s==='string'&&UID_PATTERN.test(s);
const num = n=>typeof n==='number'&&Number.isFinite(n);
const deny=()=>{throw new LocationDenied();};
const invalid=()=>{throw new LocationInvalid();};
function assertUid(value){if(!uid(value))invalid();return value;}
function exactKeys(value,keys) {
  return value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).length===keys.length &&
    Object.keys(value).every(key=>keys.includes(key));
}
function verifiedPair(relation,ownerUid,viewerUid) {
  if(!relation || relation.status!=='accepted' ||
     !((relation.senderUid===ownerUid&&relation.recipientUid===viewerUid) ||
       (relation.senderUid===viewerUid&&relation.recipientUid===ownerUid)) ||
     relation.senderConsent!==true||relation.recipientConsent!==true)deny();
}
function relationRevision(relation) {
  // Firestore Timestamp has seconds+nanoseconds. Millisecond truncation
  // can miss fast consent OFF->ON changes; M1 updates always set updatedAt.
  const updated=relation?.updatedAt;
  if(!Number.isSafeInteger(updated?.seconds) || updated.seconds<0 ||
     !Number.isSafeInteger(updated?.nanoseconds) ||
     updated.nanoseconds<0 || updated.nanoseconds>=1_000_000_000)deny();
  return updated.seconds+':'+updated.nanoseconds;
}
function validGrant(grant,ownerUid,viewerUid,now,relation) {
  if(!grant||grant.ownerUid!==ownerUid||grant.viewerUid!==viewerUid||
     grant.enabled!==true||grant.relationRevision!==relationRevision(relation)||!num(grant.expiresAtMs)||
     grant.expiresAtMs<=now||grant.expiresAtMs>now+5*60_000)deny();
}
function validPublisher(publisher,ownerUid,viewerUid,now,grant) {
  if(!publisher || publisher.ownerUid!==ownerUid ||
    publisher.viewerUid!==viewerUid || !num(publisher.expiresAtMs) ||
    publisher.expiresAtMs<=now || publisher.expiresAtMs!==grant.expiresAtMs)deny();
}
function validPoint(point,now) {
  if(!exactKeys(point,pointFields)||
     !num(point.latitude)||point.latitude< -90||point.latitude>90||
     !num(point.longitude)||point.longitude< -180||point.longitude>180||
     !num(point.capturedAtMs)||point.capturedAtMs<now-FIX_MAX_AGE_MS||
     point.capturedAtMs>now+FIX_FUTURE_SKEW_MS||
     !num(point.accuracyMeters)||point.accuracyMeters<0||
     point.accuracyMeters>ACCURACY_MAX_M)deny();
}
function time(clock) {
  const value=clock();
  if(!Number.isSafeInteger(value)||value<=0)throw new LocationBusy();
  return value;
}
export function createLocationService({adminAuth,store,rateLimiter,clock=Date.now}) {
  if(adminAuth?.app?.options?.projectId!==STAGING_PROJECT||
     typeof adminAuth?.verifyIdToken!=='function'||
     store?.projectId!==STAGING_PROJECT||
     typeof store?.transactPair!=='function'||
     rateLimiter?.persistent!==true||typeof rateLimiter?.consume!=='function'||
     typeof clock!=='function')throw new LocationBusy();

  async function authenticate(idToken) {
    if(typeof idToken!=='string'||idToken.length<32||idToken.length>8192)deny();
    let claims;
    try { claims=await adminAuth.verifyIdToken(idToken,true); }
    catch { deny(); }
    if(!uid(claims?.uid)||claims?.sub!==claims.uid||
       claims?.aud!==STAGING_PROJECT||
       claims?.iss!=='https://securetoken.google.com/'+STAGING_PROJECT)deny();
    return claims.uid; // NEVER use a UID from request body as actor.
  }
  async function limit(actor,route) {
    let accepted;
    try {accepted=await rateLimiter.consume({actor,route});}
    catch {throw new LocationBusy();}
    if(accepted!==true)throw new LocationLimited();
  }
  function tx(ownerUid,viewerUid,work) {
    // All friend, grant, point and owner-wide publisher-lease reads occur in ONE Firestore transaction.
    return store.transactPair({ownerUid,viewerUid},work);
  }
  return Object.freeze({
    async start({idToken,viewerUid}) {
      const ownerUid=await authenticate(idToken);
      assertUid(viewerUid);
      if(ownerUid===viewerUid)deny();
      await limit(ownerUid,'start');
      return tx(ownerUid,viewerUid,async ({relation,publisher,setGrant,setPublisher,deletePoint})=>{
        verifiedPair(relation,ownerUid,viewerUid);
        const now=time(clock);
        // A single owner account may have ONE foreground publisher/viewer pair
        // at a time in M2. Staging UI selects exactly one recipient per session.
        // The common owner-wide Firestore doc makes competing STARTs race-safe.
        if(publisher && (!num(publisher.expiresAtMs) ||
          publisher.expiresAtMs>now))deny();
        const expiresAtMs=now+GRANT_MS;
        setPublisher({ownerUid,viewerUid,expiresAtMs,expireAt:new Date(expiresAtMs)});
        setGrant({ownerUid,viewerUid,enabled:true,relationRevision:relationRevision(relation),expiresAtMs,
          expireAt:new Date(expiresAtMs)});
        deletePoint(); // Never expose a fix captured under a previous grant.
        return {enabled:true,expiresAtMs:now+GRANT_MS};
      });
    },
    async stop({idToken,viewerUid}) {
      const ownerUid=await authenticate(idToken);
      assertUid(viewerUid);
      if(ownerUid===viewerUid)deny();
      await limit(ownerUid,'stop');
      // Always allow authenticated owner to revoke, even if friendship was removed.
      return tx(ownerUid,viewerUid,async ({publisher,deletePublisher,deleteGrant,deletePoint})=>{
        deleteGrant();
        deletePoint();
        // Never delete another recipient's newer lease on a delayed Stop.
        if(publisher?.ownerUid===ownerUid &&
           publisher?.viewerUid===viewerUid)deletePublisher();
        return {enabled:false};
      });
    },
    async publish({idToken,viewerUid,point,appInForeground,foregroundPermissionGranted}) {
      const ownerUid=await authenticate(idToken);
      assertUid(viewerUid);
      if(ownerUid===viewerUid)deny();
      await limit(ownerUid,'publish');
      // Mobile foreground/permission statements cannot be proven by server:
      // they are additional local gates, never substitutes for server consent.
      if(appInForeground!==true||foregroundPermissionGranted!==true)deny();
      if(!exactKeys(point,pointFields))invalid();
      return tx(ownerUid,viewerUid,async ({relation,grant,publisher,setPoint})=>{
        const now=time(clock);
        verifiedPair(relation,ownerUid,viewerUid);
        validGrant(grant,ownerUid,viewerUid,now,relation);
        validPublisher(publisher,ownerUid,viewerUid,now,grant);
        validPoint(point,now);
        const expiresAtMs=Math.min(grant.expiresAtMs,now+FIX_MAX_AGE_MS);
        setPoint({ownerUid,viewerUid,point:{...point},expiresAtMs,
          expireAt:new Date(expiresAtMs)});
        return {stored:true,expiresAtMs};
      });
    },
    async read({idToken,ownerUid}) {
      const viewerUid=await authenticate(idToken);
      assertUid(ownerUid);
      if(ownerUid===viewerUid)deny();
      await limit(viewerUid,'read');
      return tx(ownerUid,viewerUid,async ({relation,grant,point,publisher})=>{
        const now=time(clock);
        verifiedPair(relation,ownerUid,viewerUid);
        validGrant(grant,ownerUid,viewerUid,now,relation);
        validPublisher(publisher,ownerUid,viewerUid,now,grant);
        if(!point||point.ownerUid!==ownerUid||point.viewerUid!==viewerUid||
           !num(point.expiresAtMs)||point.expiresAtMs<=now||
           point.expiresAtMs>grant.expiresAtMs||!exactKeys(point.point,pointFields))deny();
        validPoint(point.point,now);
        // No relationship, UID, grant, Firestore metadata, or GPS history in response.
        return {point:{...point.point},expiresAtMs:point.expiresAtMs};
      });
    }
  });
}
