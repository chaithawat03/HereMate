/**
 * M1.0 real Firestore Rules Emulator privacy matrix, synthetic identities ONLY.
 * Must run with demo-heremate-m053; never contact live Firebase.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, where, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

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
      await setDoc(doc(db,'private_location_grants',DIGEST),{enabled:true});
      await setDoc(doc(db,'private_latest_locations',DIGEST),{point:{latitude:1,longitude:2}});
      await setDoc(doc(db,'private_location_rate_limits',DIGEST),{count:1});
      await setDoc(doc(db,'private_location_publishers','uid-owner'),{viewerUid:'uid-other'});
      await setDoc(doc(db,'private_geofence_zones',DIGEST),{status:'active'});
      await setDoc(doc(db,'private_geofence_states',DIGEST),{zone:'inside'});
    });
    const paths=[['private_phone_auth',DIGEST],['private_auth_rate_limits','auth-phone_'+DIGEST],['friendships','pair-1'],['friend_requests','request-1'],['locations','uid-owner'],['private_location_grants',DIGEST],['private_latest_locations',DIGEST],['private_location_rate_limits',DIGEST],['private_location_publishers','uid-owner'],['private_geofence_zones',DIGEST],['private_geofence_states',DIGEST],['users/uid-owner/private','secret']];
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

test('M1.2–M1.4 friend request ACL, accepted friends and consent are isolated', {timeout:60000}, async t=>{
  assert.equal(process.env.GCLOUD_PROJECT,PROJECT);
  const env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:HOST,port:PORT,rules:readFileSync(RULES,'utf8')}});
  t.after(async()=>env.cleanup());
  const aid='friend-owner-uid-000001',bid='friend-target-uid-00002',cid='friend-third-uid-00003';
  const owner=env.authenticatedContext(aid).firestore();
  const target=env.authenticatedContext(bid).firestore();
  const stranger=env.authenticatedContext(cid).firestore();
  const anon=env.unauthenticatedContext().firestore();
  const requestId=aid+'__'+bid;
  const ownReq=doc(owner,'friendRequests',requestId);
  const targetReq=doc(target,'friendRequests',requestId);
  const wrongReq=doc(stranger,'friendRequests',requestId);
  const createRequest=(sender=aid,recipient=bid)=>({
    schemaVersion:1,senderUid:sender,recipientUid:recipient,
    senderDisplayName:'Owner Member',recipientDisplayName:'',
    status:'pending',senderConsent:false,recipientConsent:false,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
  });
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'users',aid),{
      displayName:'Owner Member',schemaVersion:1,shareLocation:false,
      createdAt:new Date(),updatedAt:new Date(),
    });
    await setDoc(doc(ctx.firestore(),'users',bid),{
      displayName:'Target Member',schemaVersion:1,shareLocation:false,
      createdAt:new Date(),updatedAt:new Date(),
    });
  });
  await t.test('only valid self-sent request can be created to existing private profile',async()=>{
    await assertFails(setDoc(doc(anon,'friendRequests',requestId),createRequest()));
    await assertFails(setDoc(doc(target,'friendRequests',requestId),createRequest()));
    await assertFails(setDoc(doc(owner,'friendRequests',aid+'__'+cid),createRequest(aid,cid)));
    await assertFails(setDoc(doc(owner,'friendRequests',aid+'__'+aid),createRequest(aid,aid)));
    await assertFails(setDoc(ownReq,{...createRequest(),latitude:14.1}));
    await assertFails(setDoc(ownReq,{...createRequest(),senderDisplayName:'Forged Name'}));
    await assertFails(setDoc(ownReq,{...createRequest(),senderConsent:true}));
    await assertFails(setDoc(ownReq,{...createRequest(),status:'accepted'}));
    await assertSucceeds(setDoc(ownReq,createRequest()));
    await assertFails(setDoc(ownReq,createRequest())); // No overwrite / resubmit.
  });
  await t.test('only participants get request or query by own UID; private profile unchanged',async()=>{
    await assertSucceeds(getDoc(ownReq));
    await assertSucceeds(getDoc(targetReq));
    await assertFails(getDoc(wrongReq));
    await assertFails(getDoc(doc(anon,'friendRequests',requestId)));
    await assertFails(getDocs(collection(owner,'friendRequests')));
    await assertFails(getDocs(query(collection(stranger,'friendRequests'),where('senderUid','==',aid))));
    const outgoing=await assertSucceeds(getDocs(query(collection(owner,'friendRequests'),where('senderUid','==',aid))));
    const incoming=await assertSucceeds(getDocs(query(collection(target,'friendRequests'),where('recipientUid','==',bid))));
    assert.equal(outgoing.size,1);
    assert.equal(incoming.size,1);
    await assertFails(getDoc(doc(target,'users',aid)));
  });
  await t.test('only recipient may accept; cannot alter identity, names, timestamps or GPS',async()=>{
    await assertFails(updateDoc(ownReq,{status:'accepted',recipientDisplayName:'Target Member',updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(targetReq,{status:'accepted',recipientDisplayName:'Forged Member',updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(targetReq,{senderUid:bid,status:'accepted',recipientDisplayName:'Target Member',updatedAt:serverTimestamp()}));
    await assertSucceeds(updateDoc(targetReq,{status:'accepted',recipientDisplayName:'Target Member',updatedAt:serverTimestamp()}));
    const accepted=await assertSucceeds(getDoc(ownReq));
    assert.equal(accepted.data().status,'accepted');
    assert.equal(accepted.data().recipientDisplayName,'Target Member');
    await assertFails(updateDoc(targetReq,{latitude:14.12,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(targetReq,{status:'pending',updatedAt:serverTimestamp()}));
  });
  await t.test('per-member consent defaults false; cannot change other consent; no GPS writes',async()=>{
    let state=(await assertSucceeds(getDoc(ownReq))).data();
    assert.equal(state.senderConsent,false);
    assert.equal(state.recipientConsent,false);
    await assertFails(updateDoc(ownReq,{recipientConsent:true,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(targetReq,{senderConsent:true,updatedAt:serverTimestamp()}));
    await assertSucceeds(updateDoc(ownReq,{senderConsent:true,updatedAt:serverTimestamp()}));
    await assertSucceeds(updateDoc(targetReq,{recipientConsent:true,updatedAt:serverTimestamp()}));
    await assertFails(setDoc(doc(owner,'locations',aid),{latitude:13,longitude:100}));
    await assertFails(setDoc(doc(target,'locations',bid),{latitude:13,longitude:100}));
    await assertFails(updateDoc(wrongReq,{senderConsent:false,updatedAt:serverTimestamp()}));
  });
  await t.test('either participant can remove; consent forced off; cannot resurrect or delete',async()=>{
    await assertFails(updateDoc(ownReq,{status:'removed',updatedAt:serverTimestamp()}));
    await assertSucceeds(updateDoc(targetReq,{
      status:'removed',senderConsent:false,recipientConsent:false,updatedAt:serverTimestamp(),
    }));
    const removed=await assertSucceeds(getDoc(ownReq));
    assert.equal(removed.data().senderConsent,false);
    assert.equal(removed.data().recipientConsent,false);
    await assertFails(updateDoc(targetReq,{status:'accepted',updatedAt:serverTimestamp()}));
    await assertFails(deleteDoc(ownReq));
    await assertFails(deleteDoc(targetReq));
  });
  await t.test('sender can cancel pending and recipient can decline pending; no unrelated edits',async()=>{
    const friendC='friend-other-uid-000004';
    await env.withSecurityRulesDisabled(async ctx=>{
      await setDoc(doc(ctx.firestore(),'users',friendC),{
        displayName:'Other Person',schemaVersion:1,shareLocation:false,
        createdAt:new Date(),updatedAt:new Date(),
      });
    });
    const cx=doc(owner,'friendRequests',aid+'__'+friendC);
    await assertSucceeds(setDoc(cx,createRequest(aid,friendC)));
    await assertSucceeds(updateDoc(cx,{status:'cancelled',updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(cx,{status:'accepted',updatedAt:serverTimestamp()}));
    const rx=doc(owner,'friendRequests',friendC+'__'+aid);
    const otherDb=env.authenticatedContext(friendC).firestore();
    await assertSucceeds(setDoc(doc(otherDb,'friendRequests',friendC+'__'+aid),{
      ...createRequest(friendC,aid),senderDisplayName:'Other Person',
    }));
    await assertSucceeds(updateDoc(rx,{status:'declined',updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(rx,{status:'accepted',recipientDisplayName:'Owner Member',updatedAt:serverTimestamp()}));
  });
});
