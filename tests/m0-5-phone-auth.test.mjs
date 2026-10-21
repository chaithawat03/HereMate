import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AuthNotReady,AuthRateLimited,AuthRejected,normalizeThaiMobile,
  phoneLookupDigest,createPhoneLoginService
} from '../backend/auth/phone-login.mjs';
import { handlePhoneLoginHttp } from '../backend/auth/http.mjs';

const pepper=Buffer.alloc(32,0xa3);
const dummy='$argon2id$v=19$m=19456,t=2,p=1$c3RhZ2luZw$ZmFrZQ';
const phone='+66812345678';
const uid='hereuid-0001';
const password='A long safe passphrase!';
const makeDeps=()=> {
  const calls={rates:[],lookup:[],verify:[],tokens:[],enabled:[]};
  const deps={
    pepper,
    dummyArgon2idHash:dummy,
    accountStore:{findByPhoneDigest:async key=>{calls.lookup.push(key);return {
      firebaseUid:uid,passwordHash:dummy,status:'ACTIVE',phoneVerified:false
    };}},
    passwordVerifier:{algorithm:'argon2id',verify:async(hash,plain)=>{calls.verify.push({hash,plain});return plain===password;}},
    rateLimiter:{persistent:true,consume:async item=>{calls.rates.push(item);return true;}},
    tokenIssuer:{
      assertAccountEnabled:async u=>{calls.enabled.push(u);return true;},
      createCustomToken:async u=>{calls.tokens.push(u);return 'CUSTOM-FIREBASE-JWT-'+String(u).padEnd(32,'.');}
    }
  };
  return {deps,calls};
};

test('Thai phone canonicalization and HMAC stable digest without plaintext phone',()=>{
 assert.equal(normalizeThaiMobile('081-234 5678'),phone);
 assert.equal(normalizeThaiMobile('+66 81 234 5678'),phone);
 for(const p of ['029999999','081234567','+668123456789','1234567890',null])
   assert.equal(normalizeThaiMobile(p),null);
 const d=phoneLookupDigest(phone,pepper);
 assert.equal(d,createHmac('sha256',pepper).update('phone:v1:'+phone).digest('hex'));
 assert.equal(d.length,64);
 assert.ok(!d.includes('0812345678'));
});

test('valid Phone+Password returns signed token only; never exposes raw phone/UID/password',async()=>{
 const {deps,calls}=makeDeps();
 const auth=createPhoneLoginService(deps);
 const res=await auth.login({phone:'081-234 5678',password,sourceTag:'trusted:synthetic-ip-001'});
 assert.deepEqual(Object.keys(res),['customToken']);
 assert.match(res.customToken,/CUSTOM-FIREBASE-JWT/);
 assert.deepEqual(calls.rates.map(x=>x.bucket),['auth-source','auth-phone']);
 assert.equal(calls.lookup.length,1);
 assert.equal(calls.tokens[0],uid);
 assert.equal(calls.enabled[0],uid);
 assert.ok(calls.rates.every(x=>!JSON.stringify(x).includes('0812345678')));
});

test('unknown phone and wrong password yield identical public rejection with dummy verification',async()=>{
 const {deps,calls}=makeDeps();
 const auth=createPhoneLoginService(deps);
 await assert.rejects(auth.login({phone,password:'wrong',sourceTag:'trusted:synthetic-ip-001'}),AuthRejected);
 deps.accountStore.findByPhoneDigest=async()=>null;
 const missing=createPhoneLoginService(deps);
 await assert.rejects(missing.login({phone,password,sourceTag:'trusted:synthetic-ip-001'}),AuthRejected);
 assert.equal(calls.verify.length,2);
 assert.equal(calls.verify[1].hash,dummy);
 assert.equal(calls.tokens.length,0);
});

test('disabled Firebase user, inactive profile and untrusted source cannot mint tokens',async()=>{
 const {deps,calls}=makeDeps();
 deps.tokenIssuer.assertAccountEnabled=async()=>false;
 const svc=createPhoneLoginService(deps);
 await assert.rejects(svc.login({phone,password,sourceTag:'trusted:synthetic-ip-001'}),AuthRejected);
 assert.equal(calls.tokens.length,0);
 const inactive=makeDeps();
 inactive.deps.accountStore.findByPhoneDigest=async()=>({firebaseUid:uid,passwordHash:dummy,status:'DISABLED'});
 await assert.rejects(createPhoneLoginService(inactive.deps).login({phone,password,sourceTag:'trusted:synthetic-ip-001'}),AuthRejected);
 await assert.rejects(svc.login({phone,password,sourceTag:'forwarded-by-untrusted-caller'}),AuthNotReady);
});

test('requires persistent rate limiting and Argon2id verification (fail closed)',async()=>{
 const {deps}=makeDeps();
 assert.throws(()=>createPhoneLoginService({...deps,rateLimiter:{...deps.rateLimiter,persistent:false}}),AuthNotReady);
 assert.throws(()=>createPhoneLoginService({...deps,passwordVerifier:{...deps.passwordVerifier,algorithm:'sha256'}}),AuthNotReady);
 assert.throws(()=>createPhoneLoginService({...deps,pepper:Buffer.alloc(8)}),AuthNotReady);
 assert.throws(()=>createPhoneLoginService({...deps,tokenIssuer:{createCustomToken:deps.tokenIssuer.createCustomToken}}),AuthNotReady);
 const limited=makeDeps();
 limited.deps.rateLimiter.consume=async()=>false;
 await assert.rejects(createPhoneLoginService(limited.deps).login({phone,password,sourceTag:'trusted:synthetic-ip-001'}),AuthRateLimited);
});

test('HTTP handler enforces strict POST JSON contract and safe responses',async()=>{
 const {deps}=makeDeps(),svc=createPhoneLoginService(deps);
 const req={path:'/v1/auth/phone/login',method:'POST',contentType:'application/json',sourceTag:'trusted:synthetic-ip-001',
   bodyText:JSON.stringify({phone:'0812345678',password})};
 const good=await handlePhoneLoginHttp(req,svc);
 assert.equal(good.status,200);
 assert.deepEqual(Object.keys(good.body),['customToken']);
 assert.equal(good.headers['Cache-Control'],'no-store');
 for(const [patch,expected] of [
   [{path:'/me'},404],[{method:'GET'},405],[{contentType:'text/plain'},415],
   [{bodyText:'x'.repeat(2200)},413],[{bodyText:'{'} ,400],
   [{bodyText:JSON.stringify({...JSON.parse(req.bodyText),uid:'admin'})},400],
   [{bodyText:JSON.stringify({phone:'0812345678',password:'bad'})},401],
   [{sourceTag:'client-ip-header'},503]
 ]) {
   const result=await handlePhoneLoginHttp({...req,...patch},svc);
   assert.equal(result.status,expected);
   assert.doesNotMatch(JSON.stringify(result),/0812345678|A long safe passphrase|hereuid/);
 }
});

test('API unit suite makes NO Firebase calls, app data/GPS writes, or secret exposure',()=>{
 const files=['backend/auth/phone-login.mjs','backend/auth/http.mjs','tests/m0-5-phone-auth.test.mjs'];
 for(const path of files){
   const c=readFileSync(new URL('../'+path,import.meta.url),'utf8');
   assert.doesNotMatch(c,/firebase-admin\/|getFirestore\(|setDoc\(|getDatabase\(|createServer\(|gcloud run deploy/);
 }
 const security=JSON.parse(readFileSync(new URL('../security/staging-exceptions.json',import.meta.url)));
 assert.equal(security.sourceScope,'synthetic-data-only');
});
