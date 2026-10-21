/**
 * HereMate M0.5.3 - secure Phone+Password login domain (staging contract only).
 *
 * No network, Firebase SDK, I/O, raw phone storage or deployment here.
 * Real implementations of ALL ports are required before enabling requests.
 */
import { createHmac } from 'node:crypto';

export const AUTH_FAILURE = 'Invalid phone number or password';

export class AuthRateLimited extends Error {
  constructor() { super('Too many attempts'); this.code='AUTH_RATE_LIMITED'; }
}
export class AuthRejected extends Error {
  constructor() { super(AUTH_FAILURE); this.code='AUTH_REJECTED'; }
}
export class AuthNotReady extends Error {
  constructor() { super('Authentication backend unavailable'); this.code='AUTH_NOT_READY'; }
}

/** Native TH phone numbers: 06, 08, 09; normalize to E.164. */
export function normalizeThaiMobile(input) {
  if (typeof input !== 'string') return null;
  const phone=input.trim().replace(/[\s-]/g,'');
  if (/^0[689]\d{8}$/.test(phone)) return '+66'+phone.slice(1);
  if (/^\+66[689]\d{8}$/.test(phone)) return phone;
  return null;
}

/**
 * Pepper is a backend-only, 32+ byte random HMAC key, supplied out-of-band
 * (e.g. Secret Manager). It must NOT be placed in the mobile bundle or repo.
 * Stable lookup HMAC avoids phone-number plaintext in an index.
 */
export function phoneLookupDigest(phone, pepper) {
  if (!Buffer.isBuffer(pepper) || pepper.length < 32) throw new AuthNotReady();
  if (!/^\+66[689]\d{8}$/.test(phone)) throw new AuthRejected();
  return createHmac('sha256',pepper).update('phone:v1:'+phone).digest('hex');
}

const validString=(s,min,max)=>typeof s==='string' && s.length>=min && s.length<=max;

export function createPhoneLoginService({ accountStore, passwordVerifier, rateLimiter, tokenIssuer, pepper, dummyArgon2idHash }) {
  // Fail closed: do not ship with memory-only rate limiting, plaintext passwords,
  // disabled-user-blind token signing, or missing dummy Argon2id verification.
  if (!Buffer.isBuffer(pepper) || pepper.length<32 ||
      !validString(dummyArgon2idHash,20,2048) || !dummyArgon2idHash.startsWith('$argon2id$') ||
      typeof accountStore?.findByPhoneDigest!=='function' ||
      passwordVerifier?.algorithm!=='argon2id' || typeof passwordVerifier.verify!=='function' ||
      rateLimiter?.persistent!==true || typeof rateLimiter.consume!=='function' ||
      typeof tokenIssuer?.assertAccountEnabled!=='function' ||
      typeof tokenIssuer?.createCustomToken!=='function') throw new AuthNotReady();

  return Object.freeze({
    async login({phone,password,sourceTag}) {
      // sourceTag MUST be supplied by trusted edge transport, never JSON body
      // or any unverified X-Forwarded-For value supplied by the caller.
      if (!validString(sourceTag,8,256) || !sourceTag.startsWith('trusted:'))
        throw new AuthNotReady();
      const sourceDigest=createHmac('sha256',pepper).update('source:v1:'+sourceTag).digest('hex');
      if (await rateLimiter.consume({bucket:'auth-source',key:sourceDigest})!==true)
        throw new AuthRateLimited();

      const normalized=normalizeThaiMobile(phone);
      if (!normalized || !validString(password,1,256)) throw new AuthRejected();
      const phoneDigest=phoneLookupDigest(normalized,pepper);

      // Always apply both source and phone keys. Atomic, durable consume is the
      // adapter's contract. No in-memory-only limiter in Cloud Run.
      if (await rateLimiter.consume({bucket:'auth-phone',key:phoneDigest})!==true)
        throw new AuthRateLimited();

      const account=await accountStore.findByPhoneDigest(phoneDigest);
      const hash=account?.passwordHash || dummyArgon2idHash;
      const valid=await passwordVerifier.verify(hash,password);
      if (!valid || !account || account.status!=='ACTIVE' ||
          !validString(account.firebaseUid,1,128) ||
          !hash.startsWith('$argon2id$')) throw new AuthRejected();

      // Firebase custom-token signing must not mint for disabled/removed users.
      // Never accept a UID or custom claims from client-controlled input.
      if (await tokenIssuer.assertAccountEnabled(account.firebaseUid)!==true)
        throw new AuthRejected();
      const customToken=await tokenIssuer.createCustomToken(account.firebaseUid);
      if (!validString(customToken,32,8192)) throw new AuthNotReady();
      return Object.freeze({customToken});
    }
  });
}
