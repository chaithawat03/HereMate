/**
 * Real Firebase Admin Auth verifyIdToken(..., true) against the OFFLINE
 * Authentication Emulator. Tokens are emulator-signed/unsigned test tokens:
 * this is NOT production signature validation or real staging verification.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';

const PROJECT='demo-heremate-m053';
const AUTH_HOST='127.0.0.1:9099';
const FS_HOST='127.0.0.1:8080';

test('Admin Auth accepts emulator token and denies invalid, disabled and revoked identity', {timeout:60000},async t=>{
  assert.equal(process.env.GCLOUD_PROJECT,PROJECT);
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,AUTH_HOST);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,FS_HOST);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS||'','');
  assert.match(PROJECT,/^demo-/);
  const app=initializeApp({projectId:PROJECT},'heremate-m2-auth-emulator');
  t.after(()=>deleteApp(app));
  const auth=getAuth(app);
  // Native emulator REST interface; never send this test to live Google hosts.
  const response=await fetch(
    'http://'+AUTH_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signUp?key=offline-demo-key',
    {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({returnSecureToken:true}),
      signal:AbortSignal.timeout(8000)}
  );
  assert.equal(response.status,200,'anonymous Auth emulator sign-up must succeed');
  const account=await response.json();
  assert.ok(typeof account.idToken==='string'&&account.idToken.length>64);
  assert.ok(typeof account.localId==='string'&&account.localId.length>10);
  // This calls the actual Firebase Admin implementation with revocation=true.
  const claims=await auth.verifyIdToken(account.idToken,true);
  assert.equal(claims.uid,account.localId);
  assert.equal(claims.sub,account.localId);
  assert.equal(claims.aud,PROJECT);
  assert.equal(claims.iss,'https://securetoken.google.com/'+PROJECT);
  await assert.rejects(auth.verifyIdToken('not-a-firebase-token',true));
  await auth.updateUser(account.localId,{disabled:true});
  await assert.rejects(auth.verifyIdToken(account.idToken,true));
  await auth.updateUser(account.localId,{disabled:false});
  await auth.verifyIdToken(account.idToken,true);
  // Firebase timestamps use second precision; ensure revocation is later
  // than this session's authentication time rather than same-second race.
  await new Promise(resolve=>setTimeout(resolve,1200));
  await auth.revokeRefreshTokens(account.localId);
  await assert.rejects(auth.verifyIdToken(account.idToken,true));
  await auth.deleteUser(account.localId);
});
