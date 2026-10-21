import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFirestoreAuthAdapters } from '../backend/auth/firestore-adapters.mjs';
import { createPhoneLoginService, AuthNotReady, AuthRejected } from '../backend/auth/phone-login.mjs';

const UID='synthetic-uid-1', validDigest='a'.repeat(64);
const hash='$argon2id$v=19$m=19456,t=2,p=1$c3RhZ2luZw$ZmFrZQ';
const makeEmulatedPorts=()=>{
  const data=new Map(), calls={reads:[],writes:[],transactionCount:0,tokens:[],users:[]};
  let time=1761000000000;
  const ref=(name,key)=>({
    path:name+'/'+key,
    async get() {
      calls.reads.push(this.path);
      return {exists:data.has(this.path),data:()=>structuredClone(data.get(this.path))};
    }
  });
  const firestore={
    projectId:'heremate',
    collection:name=>({doc:key=>ref(name,key)}),
    async runTransaction(callback){
      calls.transactionCount++;
      const tx={
        get:ref=>ref.get(),
        set:(ref,row)=>{calls.writes.push(ref.path);data.set(ref.path,structuredClone(row));}
      };
      return callback(tx);
    }
  };
  const adminAuth={
    app:{options:{projectId:'heremate'}},
    async getUser(uid){calls.users.push(uid);return {uid,disabled:false};},
    async createCustomToken(uid){calls.tokens.push(uid);return 'FAKE-CUSTOM-TOKEN-'+uid.padEnd(48,'-');}
  };
  const make=()=>createFirestoreAuthAdapters({firestore,adminAuth,clock:()=>time});
  return {firestore,adminAuth,data,calls,make,setTime:n=>{time=n;}};
};

test('pins both backend Firestore and Firebase Admin to exact HereMate staging project',()=>{
 const {firestore,adminAuth}=makeEmulatedPorts();
 assert.throws(()=>createFirestoreAuthAdapters({firestore:{...firestore,projectId:'production'},adminAuth}),AuthNotReady);
 assert.throws(()=>createFirestoreAuthAdapters({firestore,adminAuth:{...adminAuth,app:{options:{projectId:'production'}}}}),AuthNotReady);
 assert.throws(()=>createFirestoreAuthAdapters({firestore,adminAuth:{...adminAuth,createCustomToken:null}}),AuthNotReady);
});

test('credential adapter returns only server-side UID/hash/status and never phone',async()=>{
 const p=makeEmulatedPorts();
 const path='private_phone_auth/'+validDigest;
 p.data.set(path,{firebaseUid:UID,passwordHash:hash,status:'ACTIVE',phone:'0812345678',roles:['admin'],customClaims:{admin:true}});
 const account=await p.make().accountStore.findByPhoneDigest(validDigest);
 assert.deepEqual(account,{firebaseUid:UID,passwordHash:hash,status:'ACTIVE'});
 assert.deepEqual(p.calls.reads,[path]);
 assert.equal(await p.make().accountStore.findByPhoneDigest('b'.repeat(64)),null);
 await assert.rejects(p.make().accountStore.findByPhoneDigest('raw-phone'),AuthNotReady);
 p.data.set(path,{firebaseUid:UID,status:'ACTIVE',passwordHash:'password-in-plaintext'});
 await assert.rejects(p.make().accountStore.findByPhoneDigest(validDigest),AuthNotReady);
});

test('rate limiter is durable transactional: account 5/15m, trusted source 30/15m',async()=>{
 const p=makeEmulatedPorts(),rate=p.make().rateLimiter;
 assert.equal(rate.persistent,true);
 for(let i=0;i<5;i++)assert.equal(await rate.consume({bucket:'auth-phone',key:validDigest}),true);
 assert.equal(await rate.consume({bucket:'auth-phone',key:validDigest}),false);
 assert.equal(p.data.get('private_auth_rate_limits/auth-phone_'+validDigest).count,5);
 const sourceKey='b'.repeat(64);
 for(let i=0;i<30;i++)assert.equal(await rate.consume({bucket:'auth-source',key:sourceKey}),true);
 assert.equal(await rate.consume({bucket:'auth-source',key:sourceKey}),false);
 assert.equal(p.calls.transactionCount,37);
 p.setTime(1761000000000+15*60*1000);
 assert.equal(await rate.consume({bucket:'auth-phone',key:validDigest}),true);
 assert.equal(p.data.get('private_auth_rate_limits/auth-phone_'+validDigest).count,1);
 assert.ok(p.calls.writes.every(path=>path.startsWith('private_auth_rate_limits/')));
});

test('denies malicious bucket/key, corrupt counters and backwards clock',async()=>{
 const p=makeEmulatedPorts(),limiter=p.make().rateLimiter;
 await assert.rejects(limiter.consume({bucket:'root',key:validDigest}),AuthNotReady);
 await assert.rejects(limiter.consume({bucket:'auth-phone',key:'../admin'}),AuthNotReady);
 p.data.set('private_auth_rate_limits/auth-phone_'+validDigest,{count:-1,windowStartedAtMillis:1761000000000});
 await assert.rejects(limiter.consume({bucket:'auth-phone',key:validDigest}),AuthNotReady);
 p.data.set('private_auth_rate_limits/auth-phone_'+validDigest,{count:1,windowStartedAtMillis:1762000000000});
 await assert.rejects(limiter.consume({bucket:'auth-phone',key:validDigest}),AuthNotReady);
});

test('Admin signer validates Firebase user status and never accepts custom claims',async()=>{
 const p=makeEmulatedPorts(),issuer=p.make().tokenIssuer;
 assert.equal(await issuer.assertAccountEnabled(UID),true);
 assert.match(await issuer.createCustomToken(UID),/FAKE-CUSTOM-TOKEN/);
 assert.deepEqual(p.calls.tokens,[UID]);
 await assert.rejects(issuer.assertAccountEnabled('!!!'),AuthNotReady);
});
