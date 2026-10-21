/**
 * HereMate M0.5.3 real Firebase Firestore Emulator security tests.
 * These tests MUST NEVER contact the real project: use only demo-heremate-m053.
 * No production credentials, OAuth secrets, GPS or real identity records.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT='demo-heremate-m053';
const HOST='127.0.0.1';
const PORT=8080;
const RULES=new URL('../firestore.rules',import.meta.url);
const HMAC='a'.repeat(64);

test('staging deny-all rules are enforced by actual offline Firestore Emulator', {timeout:60000}, async t => {
  // Fail closed: guard must be checked BEFORE test library initialization.
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, HOST+':'+PORT, 'Firebase emulator host is required');
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT, 'Must use demo project only');
  assert.match(PROJECT,/^demo-/);
  assert.ok(readFileSync(RULES,'utf8').includes('allow read, write: if false;'));
  const env=await initializeTestEnvironment({
    projectId:PROJECT,
    firestore:{host:HOST,port:PORT,rules:readFileSync(RULES,'utf8')}
  });
  t.after(async()=>env.cleanup());

  // Test setup bypasses client Rules ONLY for synthetic fixtures inside emulator.
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'private_phone_auth',HMAC),
      {firebaseUid:'synthetic-owner',passwordHash:'synthetic-placeholder',status:'ACTIVE'});
    await setDoc(doc(db,'private_auth_rate_limits','auth-phone_'+HMAC),
      {count:1,windowStartedAtMillis:1720000000000});
    await setDoc(doc(db,'users','synthetic-owner'),{handle:'synthetic-owner'});
    await setDoc(doc(db,'friendships','synthetic-edge'),{from:'synthetic-owner',to:'synthetic-other'});
  });

  const scenarios=[
    ['unauthenticated',env.unauthenticatedContext()],
    ['anonymous guest',env.authenticatedContext('synthetic-guest', {firebase:{sign_in_provider:'anonymous'}})],
    ['Google account',env.authenticatedContext('synthetic-owner', {firebase:{sign_in_provider:'google.com'}})],
    ['other signed-in user',env.authenticatedContext('synthetic-other', {firebase:{sign_in_provider:'password'}})]
  ];
  const paths=[
    ['private_phone_auth',HMAC],
    ['private_auth_rate_limits','auth-phone_'+HMAC],
    ['users','synthetic-owner'],
    ['friendships','synthetic-edge'],
    ['locations','synthetic-owner']
  ];
  for (const [label,ctx] of scenarios) {
    await t.test(label+' cannot read, query, create, change or delete any private collection',async()=>{
      const db=ctx.firestore();
      for (const [group,id] of paths) {
        const ref=doc(db,group,id);
        await assertFails(getDoc(ref));
        await assertFails(getDocs(collection(db,group)));
        await assertFails(setDoc(ref,{attempt:'blocked'}));
        await assertFails(updateDoc(ref,{attempt:'blocked'}));
        await assertFails(deleteDoc(ref));
      }
    });
  }

  // The emulator fixture should still exist; all client mutations were denied.
  await env.withSecurityRulesDisabled(async ctx=>{
    const d=await getDoc(doc(ctx.firestore(),'private_phone_auth',HMAC));
    assert.equal(d.exists(),true);
    assert.equal(d.data().firebaseUid,'synthetic-owner');
  });
});
