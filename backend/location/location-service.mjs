/**
 * M2.1 Staging location API DOMAIN — NOT deployed or imported by Android.
 * Verified Firebase ID token + atomic Firestore data from trusted adapters only.
 * No Firebase credentials, coordinates or tokens are ever logged.
 */
import {createHash,randomBytes} from 'node:crypto';
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
// Firestore pair IDs use ownerUid + "__" + viewerUid, but Firebase UIDs
// themselves can contain "__". A colliding authenticated pair must never
// revoke another pair's stored grant or latest GPS point.
function verifiedStoredPair(record,ownerUid,viewerUid) {
  if(record && (record.ownerUid!==ownerUid||record.viewerUid!==viewerUid))deny();
}
function validPublisher(publisher,ownerUid,viewerUid,now,grant) {
  if(!publisher || publisher.ownerUid!==ownerUid ||
    publisher.viewerUid!==viewerUid || !num(publisher.expiresAtMs) ||
    publisher.expiresAtMs<=now || publisher.expiresAtMs!==grant.expiresAtMs)deny();
  // M3 device sessions are issued for exactly GRANT_MS (60s). The older
  // M2/v1 contract retains its original validation window, but a v2
  // capability-tagged grant must never become a forged longer-lived lease
  // merely because the grant and owner-wide publisher agree on expiry.
  // This check applies to both publisher writes and viewer reads; STOP
  // remains independent of the lease validity so the owner can revoke.
  if(grant.sessionDigest!==undefined||publisher.sessionDigest!==undefined){
    if(!Number.isSafeInteger(grant.expiresAtMs)||
      grant.expiresAtMs>now+GRANT_MS)deny();
  }
}
// M3: short-lived device-session capability (never stored in plaintext).
// This fences accidental concurrent publishers signed in under the same
// Firebase account. A Firebase owner can still emergency-revoke via v1 STOP.
const CAPABILITY=/^[0-9a-f]{64}$/;
const digestSession=secret=>{
  if(typeof secret!=='string'||!CAPABILITY.test(secret))invalid();
  return createHash('sha256').update('m3-device-session:v1:'+secret).digest('hex');
};
function verifyDeviceSession(grant,publisher,sessionDigest){
  if(!grant||!publisher||grant.sessionDigest!==sessionDigest||
     publisher.sessionDigest!==sessionDigest)deny();
}
// M3 viewer privacy: a recent point is not sufficient proof that it belongs
// to the CURRENT owner-wide device lease. M3 writes only a purpose-hashed
// session digest, never the bearer token, on its one short-lived latest point.
// Legacy M2 v1 grants and points (all without a digest) remain readable.
function verifyReadablePointLease(grant,publisher,storedPoint){
  const grantDigest=grant.sessionDigest;
  const publisherDigest=publisher.sessionDigest;
  const pointDigest=storedPoint.sessionDigest;
  if(grantDigest===undefined&&publisherDigest===undefined){
    if(pointDigest!==undefined)deny(); // never expose a v2 point as v1
    return;
  }
  if(typeof grantDigest!=='string'||!CAPABILITY.test(grantDigest)||
     grantDigest!==publisherDigest||grantDigest!==pointDigest)deny();
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
      // A transient per-account quota must NEVER prevent a signed-in owner
      // from stopping the sharing lease. Consume the normal quota where
      // possible, but treat ONLY a known quota-denial as a safety override;
      // Firestore failures still fail closed rather than pretending STOP.
      try {await limit(ownerUid,'stop');}
      catch (error) {
        if(!(error instanceof LocationLimited))throw error;
      }
      // No consent requirement: STOP remains valid even after unfriend/logout
      // from the other device. Repeat STOP is idempotent and doesn't write.
      return tx(ownerUid,viewerUid,async ({
        grant,point,publisher,deletePublisher,deleteGrant,deletePoint
      })=>{
        // STOP must remain usable after unfriend, but never delete a
        // different pair's documents if legacy UID pair IDs collide.
        verifiedStoredPair(grant,ownerUid,viewerUid);
        verifiedStoredPair(point,ownerUid,viewerUid);
        if(grant)deleteGrant();
        if(point)deletePoint();
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
        // Legacy v1 publishers may not inject fixes into a newer
        // device-fenced M3 lease, even when Firebase UID/viewer matches.
        if(grant.sessionDigest||publisher.sessionDigest)deny();
        validPoint(point,now);
        const expiresAtMs=Math.min(grant.expiresAtMs,now+FIX_MAX_AGE_MS);
        setPoint({ownerUid,viewerUid,point:{...point},expiresAtMs,
          expireAt:new Date(expiresAtMs)});
        return {stored:true,expiresAtMs};
      });
    },
    // M3 opt-in capability-bound START: the secret is generated on the
    // server, returned only to the authenticated publisher and retained
    // only as a salted-purpose SHA-256 digest in private Firestore docs.
    async startDevice({idToken,viewerUid}){
      const ownerUid=await authenticate(idToken);
      assertUid(viewerUid);
      if(ownerUid===viewerUid)deny();
      await limit(ownerUid,'start');
      return tx(ownerUid,viewerUid,async ({
        relation,publisher,setGrant,setPublisher,deletePoint
      })=>{
        verifiedPair(relation,ownerUid,viewerUid);
        const now=time(clock);
        if(publisher&&(!num(publisher.expiresAtMs)||
           publisher.expiresAtMs>now))deny();
        const sessionToken=randomBytes(32).toString('hex');
        const sessionDigest=digestSession(sessionToken);
        const expiresAtMs=now+GRANT_MS;
        setPublisher({ownerUid,viewerUid,expiresAtMs,
          sessionDigest,expireAt:new Date(expiresAtMs)});
        setGrant({ownerUid,viewerUid,enabled:true,
          relationRevision:relationRevision(relation),
          expiresAtMs,sessionDigest,expireAt:new Date(expiresAtMs)});
        deletePoint();
        return {enabled:true,expiresAtMs,sessionToken};
      });
    },
    async publishDevice({idToken,viewerUid,sessionToken,point,
      appInForeground,foregroundPermissionGranted}){
      const ownerUid=await authenticate(idToken);
      assertUid(viewerUid);
      if(ownerUid===viewerUid)deny();
      const sessionDigest=digestSession(sessionToken);
      await limit(ownerUid,'publish');
      if(appInForeground!==true||foregroundPermissionGranted!==true)deny();
      if(!exactKeys(point,pointFields))invalid();
      return tx(ownerUid,viewerUid,async ({
        relation,grant,publisher,setPoint
      })=>{
        const now=time(clock);
        verifiedPair(relation,ownerUid,viewerUid);
        validGrant(grant,ownerUid,viewerUid,now,relation);
        validPublisher(publisher,ownerUid,viewerUid,now,grant);
        verifyDeviceSession(grant,publisher,sessionDigest);
        validPoint(point,now);
        // A location fix captured BEFORE this device was granted its M3
        // publisher lease must not be re-used as a consented live position.
        // The v2 lease is issued for exactly GRANT_MS; v1 is unchanged.
        // No GPS history or additional Firestore fields are required.
        if(!Number.isSafeInteger(point.capturedAtMs)||
           point.capturedAtMs<grant.expiresAtMs-GRANT_MS)deny();
        const expiresAtMs=Math.min(grant.expiresAtMs,now+FIX_MAX_AGE_MS);
        setPoint({ownerUid,viewerUid,point:{...point},sessionDigest,expiresAtMs,
          expireAt:new Date(expiresAtMs)});
        return {stored:true,expiresAtMs};
      });
    },
    async stopDevice({idToken,viewerUid,sessionToken}){
      const ownerUid=await authenticate(idToken);
      assertUid(viewerUid);
      if(ownerUid===viewerUid)deny();
      const sessionDigest=digestSession(sessionToken);
      try{await limit(ownerUid,'stop');}
      catch(error){if(!(error instanceof LocationLimited))throw error;}
      return tx(ownerUid,viewerUid,async ({
        grant,point,publisher,deleteGrant,deletePoint,deletePublisher
      })=>{
        verifiedStoredPair(grant,ownerUid,viewerUid);
        verifiedStoredPair(point,ownerUid,viewerUid);
        if(!grant)return {enabled:false}; // idempotent expired session
        if(grant.sessionDigest!==sessionDigest)deny();
        // A delayed stop from another device cannot erase a newer
        // same-viewer session nor a different viewer's active publisher.
        if(publisher?.ownerUid===ownerUid&&publisher?.viewerUid===viewerUid&&
           publisher?.sessionDigest!==sessionDigest)deny();
        deleteGrant();
        if(point)deletePoint();
        if(publisher?.ownerUid===ownerUid&&publisher?.viewerUid===viewerUid)
          deletePublisher();
        return {enabled:false};
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
        verifyReadablePointLease(grant,publisher,point);
        validPoint(point.point,now);
        // Apply the same v2 post-START capture boundary to viewer READ.
        // A forged/orphan latest point cannot become visible merely because
        // its session digest matches the current publisher's lease.
        if(grant.sessionDigest!==undefined&&
           (!Number.isSafeInteger(point.point.capturedAtMs)||
            point.point.capturedAtMs<grant.expiresAtMs-GRANT_MS))deny();
        // No relationship, UID, grant, Firestore metadata, or GPS history in response.
        return {point:{...point.point},expiresAtMs:point.expiresAtMs};
      });
    }
  });
}
