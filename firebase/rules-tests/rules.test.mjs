/**
 * M1.0 real Firestore Rules Emulator privacy matrix, synthetic identities ONLY.
 * Must run with demo-heremate-m053; never contact live Firebase.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT='demo-heremate-m053';
const HOST='127.0.0.1', PORT=8080;
const RULES=new URL('../firestore.rules',import.meta.url);
const DIGEST='a'.repeat(64);
const newProfile=(displayName='Test Guest')=>({
  displayName,schemaVersion:1,shareLocation:false,
  createdAt:serverTimestamp(),updatedAt:serverTimestamp()
});

test('M1.0 Firestore owner profile and reserved collections ACL', {timeout:60000}, async t=>{
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST+':'+PORT);
  assert.equal(process.env.GCLOUD_PROJECT,PROJECT);
  assert.match(PROJECT,/^demo-/);
  const env=await initializeTestEnvironment({
    projectId:PROJECT,firestore:{host:HOST,port:PORT,rules:readFileSync(RULES,'utf8')}
  });
  t.after(async()=>env.cleanup());
  const anon=env.unauthenticatedContext().firestore();
  const owner=env.authenticatedContext('uid-owner',{firebase:{sign_in_provider:'anonymous'}}).firestore();
  const other=env.authenticatedContext('uid-other',{firebase:{sign_in_provider:'google.com'}}).firestore();
  const ownerDoc=doc(owner,'users','uid-owner');
  const otherOwnerDoc=doc(other,'users','uid-owner');

  await t.test('only authenticated owner may create and read exact private profile',async()=>{
    await assertFails(getDoc(doc(anon,'users','uid-owner')));
    await assertFails(setDoc(doc(anon,'users','uid-owner'),newProfile()));
    await assertFails(setDoc(doc(other,'users','uid-owner'),newProfile()));
    await assertSucceeds(setDoc(ownerDoc,newProfile()));
    const own=await assertSucceeds(getDoc(ownerDoc));
    assert.equal(own.data().shareLocation,false);
    assert.equal(own.data().displayName,'Test Guest');
    await assertFails(getDoc(otherOwnerDoc));
    await assertFails(getDocs(collection(owner,'users')));
    await assertFails(getDocs(collection(other,'users')));
  });
  await t.test('owner rename allowed, but extra fields, sharing, timestamp forging and deletes denied',async()=>{
    await assertSucceeds(updateDoc(ownerDoc,{displayName:'New Name',updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(ownerDoc,{shareLocation:true,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(ownerDoc,{email:'example@invalid.test',updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(ownerDoc,{gpsLatitude:12.34,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(ownerDoc,{displayName:'X',updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(ownerDoc,{displayName:'Untrusted',updatedAt:new Date(2001,1,1)}));
    await assertFails(deleteDoc(ownerDoc));
    await assertFails(updateDoc(otherOwnerDoc,{displayName:'Hijacked',updatedAt:serverTimestamp()}));
    const own=await assertSucceeds(getDoc(ownerDoc));
    assert.equal(own.data().displayName,'New Name');
    assert.equal(own.data().shareLocation,false);
  });
  await t.test('other user may create only own private profile, not publish location',async()=>{
    const their=doc(other,'users','uid-other');
    await assertFails(setDoc(their,{...newProfile(),shareLocation:true}));
    await assertFails(setDoc(their,{...newProfile(),phoneNumber:'0123456789'}));
    await assertFails(setDoc(their,{...newProfile(),createdAt:new Date(2001,1,1)}));
    await assertSucceeds(setDoc(their,newProfile('Second User')));
    await assertFails(getDoc(doc(owner,'users','uid-other')));
  });
  await t.test('private credentials, relationships, locations and user subcollections stay denied',async()=>{
    await env.withSecurityRulesDisabled(async ctx=>{
      const db=ctx.firestore();
      await setDoc(doc(db,'private_phone_auth',DIGEST),{passwordHash:'fake',firebaseUid:'uid-owner'});
      await setDoc(doc(db,'private_auth_rate_limits','auth-phone_'+DIGEST),{count:1});
      await setDoc(doc(db,'friendships','pair-1'),{memberUids:['uid-owner','uid-other']});
      await setDoc(doc(db,'friend_requests','request-1'),{senderUid:'uid-owner'});
      await setDoc(doc(db,'locations','uid-owner'),{latitude:1,longitude:2});
    });
    const paths=[['private_phone_auth',DIGEST],['private_auth_rate_limits','auth-phone_'+DIGEST],['friendships','pair-1'],['friend_requests','request-1'],['locations','uid-owner'],['users/uid-owner/private','secret']];
    for(const db of [anon,owner,other]){
      for(const [col,id] of paths){
        const ref=doc(db,col,id);
        await assertFails(getDoc(ref));
        await assertFails(setDoc(ref,{status:'blocked'}));
        await assertFails(updateDoc(ref,{status:'blocked'}));
        await assertFails(deleteDoc(ref));
      }
    }
  });
});
