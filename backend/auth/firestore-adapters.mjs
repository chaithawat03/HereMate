/**
 * M0.5.3: Firestore credential and durable rate-limit adapters + Firebase Admin
 * Custom Token signing adapter. Staging-only; does not initialize SDKs.
 *
 * IMPORTANT: these adapters run ONLY on a trusted Cloud Run backend under a
 * separate least-privilege service account. Never import this module in Expo.
 */
import { AuthNotReady } from './phone-login.mjs';

const STAGING_PROJECT='heremate';
const HEX_64=/^[a-f0-9]{64}$/;
const UID=/^[a-zA-Z0-9_.:-]{1,128}$/;
const WINDOW_MS=15*60*1000;
const LIMITS=Object.freeze({'auth-source':30,'auth-phone':5});

export function createFirestoreAuthAdapters({ firestore, adminAuth, clock=Date.now }) {
  // Explicit app and Firestore project ID pinning prevents staging from
  // accidentally minting tokens or fetching credentials from Production.
  if (firestore?.projectId!==STAGING_PROJECT ||
      adminAuth?.app?.options?.projectId!==STAGING_PROJECT ||
      typeof firestore.collection!=='function' ||
      typeof firestore.runTransaction!=='function' ||
      typeof adminAuth.getUser!=='function' ||
      typeof adminAuth.createCustomToken!=='function' ||
      typeof clock!=='function') throw new AuthNotReady();

  const accounts=firestore.collection('private_phone_auth');
  const limits=firestore.collection('private_auth_rate_limits');
  if (typeof accounts?.doc!=='function'||typeof limits?.doc!=='function') throw new AuthNotReady();

  const accountStore=Object.freeze({
    async findByPhoneDigest(digest) {
      if (!HEX_64.test(digest)) throw new AuthNotReady();
      const snapshot=await accounts.doc(digest).get();
      if (!snapshot.exists) return null;
      const data=snapshot.data();
      if (!data || !UID.test(data.firebaseUid||'') ||
          !['ACTIVE','DISABLED'].includes(data.status) ||
          typeof data.passwordHash!=='string' ||
          !data.passwordHash.startsWith('$argon2id$'))
        throw new AuthNotReady();
      // Never expose phone/account lookup information to the mobile app.
      return Object.freeze({
        firebaseUid:data.firebaseUid,
        passwordHash:data.passwordHash,
        status:data.status
      });
    }
  });

  const rateLimiter=Object.freeze({
    persistent:true,
    async consume({bucket,key}) {
      if (!Object.hasOwn(LIMITS,bucket) || !HEX_64.test(key)) throw new AuthNotReady();
      const now=clock();
      if (!Number.isSafeInteger(now)||now<=0) throw new AuthNotReady();
      const max=LIMITS[bucket];
      const ref=limits.doc(bucket+'_'+key);
      // Firestore transactions serialize concurrent counter updates; failure
      // to read, validate or commit fails closed (Cloud Run returns 503).
      return firestore.runTransaction(async tx=>{
        const snap=await tx.get(ref);
        let count=0,startedAt=now;
        if(snap.exists) {
          const row=snap.data();
          if (!row || !Number.isSafeInteger(row.count) || row.count<1 ||
              !Number.isSafeInteger(row.windowStartedAtMillis) ||
              row.windowStartedAtMillis<=0 || row.windowStartedAtMillis>now)
            throw new AuthNotReady();
          if(now-row.windowStartedAtMillis<WINDOW_MS) {
            count=row.count;
            startedAt=row.windowStartedAtMillis;
          }
        }
        if(count>=max) return false;
        tx.set(ref,{
          count:count+1,
          windowStartedAtMillis:startedAt,
          // TTL deletion is optional cleanup, never relied on for admission.
          expireAt:new Date(startedAt+WINDOW_MS+24*60*60*1000)
        });
        return true;
      });
    }
  });

  const tokenIssuer=Object.freeze({
    async assertAccountEnabled(uid) {
      if (!UID.test(uid)) throw new AuthNotReady();
      try {
        const record=await adminAuth.getUser(uid);
        return record?.uid===uid && record.disabled!==true;
      } catch(error) {
        // Missing/removed user is a generic credential failure. Permission,
        // transport, or IAM errors must fail closed as 503 instead.
        if (error?.code==='auth/user-not-found') return false;
        throw error;
      }
    },
    async createCustomToken(uid) {
      if (!UID.test(uid)) throw new AuthNotReady();
      return adminAuth.createCustomToken(uid); // no client-supplied claims
    }
  });
  return Object.freeze({accountStore,rateLimiter,tokenIssuer});
}
