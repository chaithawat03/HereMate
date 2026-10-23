import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadAuthorizedFriendMap} from '../src/location/accountScopedFriendMapRead.ts';
import {authorizedPeers} from '../src/location/m2FriendLocationView.ts';

const A='androidvieweruid00001',B='anotherandroiduid00002';
const peer=n=>'friendaccountuid'+String(n).padStart(4,'0');
const relation=(other,patch={})=>({
  id:'request-'+other,senderUid:A,recipientUid:other,
  senderDisplayName:'Owner A',recipientDisplayName:'Friend '+other,
  status:'accepted',senderConsent:true,recipientConsent:true,...patch
});
const fix={point:{latitude:13.75,longitude:100.5,accuracyMeters:20,
  capturedAtMs:1_800_000_000_000},expiresAtMs:1_800_000_020_000};
const deferred=()=>{
  let resolve;const promise=new Promise(r=>{resolve=r;});
  return {promise,resolve};
};
function rig(rows=[relation(peer(1))]){
  let uid=A,foreground=true,revision=0,reads=[];
  const active=()=>uid===A&&foreground&&revision===0;
  const ports={viewerUid:A,isCurrent:active,
    loadRelations:async()=>rows,selectPeers:authorizedPeers,
    readPeer:async id=>{reads.push(id);return fix;}};
  return {ports,reads,setUid:x=>{uid=x;},
    setForeground:x=>{foreground=x;},invalidate:()=>{revision++;}};
}
test('Android map reads only unique, accepted, bilaterally consented friends and caps HTTP fanout',async()=>{
  const rows=Array.from({length:12},(_,i)=>relation(peer(i+1)));
  rows.push(relation(peer(99),{status:'pending'}));
  rows.push(relation(peer(98),{senderConsent:false}));
  rows.push(relation(peer(97),{recipientConsent:false}));
  rows.push(relation(peer(96),{senderUid:B,recipientUid:peer(96)}));
  const x=rig(rows);
  const snapshot=await loadAuthorizedFriendMap(x.ports);
  assert.ok(snapshot);
  assert.equal(x.reads.length,8);
  assert.equal(Object.keys(snapshot.reads).length,8);
  assert.equal(snapshot.partialFailure,false);
  assert.equal(snapshot.relations.length,15,'unrelated account row is not retained');
  assert.ok(snapshot.relations.every(r=>r.senderUid===A||r.recipientUid===A));
  assert.ok(x.reads.every(id=>id!==peer(98)&&id!==peer(97)&&id!==peer(99)));
});
test('direct Firebase identity change during delayed relation read never starts HTTP reads',async()=>{
  const x=rig(),pending=deferred();
  x.ports.loadRelations=()=>pending.promise;
  const work=loadAuthorizedFriendMap(x.ports);
  x.setUid(B);
  pending.resolve([relation(peer(1))]);
  assert.equal(await work,null);
  assert.deepEqual(x.reads,[]);
});
test('direct identity change during pending HTTP reads drops all private names and positions',async()=>{
  const x=rig([relation(peer(1)),relation(peer(2))]);
  const pending=deferred();
  x.ports.readPeer=async id=>{x.reads.push(id);return pending.promise;};
  const work=loadAuthorizedFriendMap(x.ports);
  await Promise.resolve();
  assert.equal(x.reads.length,2);
  x.setUid(B);
  pending.resolve(fix);
  assert.equal(await work,null);
});
test('background, invalidated refresh, and sign-out all suppress late responses',async()=>{
  for(const incident of ['background','invalidate','signout']){
    const x=rig(),pending=deferred();
    x.ports.readPeer=()=>pending.promise;
    const work=loadAuthorizedFriendMap(x.ports);
    await Promise.resolve();
    if(incident==='background')x.setForeground(false);
    if(incident==='invalidate')x.invalidate();
    if(incident==='signout')x.setUid(null);
    pending.resolve(fix);
    assert.equal(await work,null,incident);
  }
});
test('duplicate directed relations, revocation and read failure fail closed without stale coordinates',async()=>{
  const x=rig([
    relation(peer(1)),relation(peer(1),{id:'duplicate'}),
    relation(peer(2),{recipientConsent:false}),
    relation(peer(3))
  ]);
  x.ports.readPeer=async id=>{
    x.reads.push(id);
    throw Error('ACL_denied');
  };
  const snapshot=await loadAuthorizedFriendMap(x.ports);
  assert.ok(snapshot);
  assert.deepEqual(x.reads,[peer(3)]);
  assert.deepEqual(snapshot.reads,{});
  assert.equal(snapshot.partialFailure,true);
});
test('Android mounted panel validates live Firebase identity before refresh, commit and render',()=>{
  const s=readFileSync(new URL('../src/location/M2FriendLocationPanel.tsx',import.meta.url),'utf8');
  assert.match(s,/loadAuthorizedFriendMap/);
  assert.match(s,/getStagingGuestAuth\(\)\.currentUser\?\.uid===uid/);
  assert.match(s,/getStagingGuestAuth\(\)\.currentUser\?\.uid!==uid/);
  assert.match(s,/session\.current===getStagingGuestAuth\(\)\.currentUser\?\.uid/);
  assert.match(s,/AppState\.currentState==='active'/);
  assert.doesNotMatch(s,/AsyncStorage|startLocationUpdatesAsync|requestBackgroundPermissionsAsync/);
});
