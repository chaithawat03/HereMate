import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAccountScopedFriendRefresh} from '../src/location/accountScopedFriendRefresh.ts';

const A='geofenceowneruid00001',B='geofencesubjectuid002';
const delayed=()=>{
 let settle,fail;
 const promise=new Promise((resolve,reject)=>{settle=resolve;fail=reject;});
 return {promise,settle,fail};
};
function subjectPanel(){
 let actual=A,lastAuthCallback=A,foreground=true;
 const committed=[],errors=[];
 const gate=createAccountScopedFriendRefresh({
   currentUid:()=>actual===lastAuthCallback?actual:null,
   isForeground:()=>foreground
 });
 const reload=async load=>gate.run(load,(rows,uid)=>{
   committed.push({uid,rows:rows.filter(r=>r.senderUid===uid||r.recipientUid===uid)});
 },()=>errors.push('unavailable'));
 return {gate,reload,committed,errors,
   setActual:x=>{actual=x;},
   setAuthCallback:x=>{lastAuthCallback=x;gate.invalidate();},
   setForeground:x=>{foreground=x;gate.invalidate();},
 };
}
const relation=(owner,subject)=>({senderUid:owner,recipientUid:subject,status:'accepted',
 senderConsent:true,recipientConsent:true});
test('M4 may render names only for the actual current Firebase owner',async()=>{
 const x=subjectPanel();
 assert.equal(await x.reload(async()=>[
   relation(A,B),relation('stranger0000000001','other000000000001')
 ]),true);
 assert.deepEqual(x.committed,[{uid:A,rows:[relation(A,B)]}]);
});
test('M4 old async friend list is discarded if Firebase switches before auth callback',async()=>{
 const x=subjectPanel();
 const request=delayed(),old=x.reload(()=>request.promise);
 await Promise.resolve();
 x.setActual(B);
 request.settle([relation(A,'other000000000001')]);
 assert.equal(await old,false);
 assert.deepEqual(x.committed,[]);
 x.setAuthCallback(B);
 assert.equal(await x.reload(async()=>[relation(B,A)]),true);
 assert.deepEqual(x.committed,[{uid:B,rows:[relation(B,A)]}]);
});
test('M4 background discards names and errors, foreground needs a fresh read',async()=>{
 const x=subjectPanel();
 const request=delayed(),old=x.reload(()=>request.promise);
 x.setForeground(false);
 request.settle([relation(A,B)]);
 assert.equal(await old,false);
 assert.equal(await x.reload(async()=>[relation(A,B)]),false);
 x.setForeground(true);
 assert.equal(await x.reload(async()=>[relation(A,B)]),true);
 assert.equal(x.committed.length,1);
 const err=delayed(),pending=x.reload(()=>err.promise);
 x.setForeground(false);
 err.fail(Error('offline'));
 assert.equal(await pending,false);
 assert.deepEqual(x.errors,[]);
});
test('M4 out-of-order friend refresh cannot repaint after newer refresh/unmount',async()=>{
 const x=subjectPanel(),first=delayed();
 const a=x.reload(()=>first.promise);
 const b=x.reload(async()=>[relation(A,B)]);
 first.settle([relation(A,'stale000000000001')]);
 assert.equal(await a,false);
 assert.equal(await b,true);
 assert.deepEqual(x.committed.map(v=>v.rows[0].recipientUid),[B]);
 const late=delayed(),stale=x.reload(()=>late.promise);
 x.gate.dispose();
 late.settle([relation(A,'private00000000001')]);
 assert.equal(await stale,false);
 assert.equal(x.committed.length,1);
});
test('M4 UI clears sensitive state and isolates mutation replies across background/auth',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const s=read('src/geofences/M4GeofencePanel.tsx');
 assert.match(s,/createAccountScopedFriendRefresh/);
 assert.match(s,/actual===identity\.current\?actual:null/);
 assert.match(s,/friendGate\.current\?\.invalidate\(\)/);
 assert.match(s,/gate\.dispose\(\)/);
 assert.match(s,/setFriends\(\[\]\);setBusy\(false\)/);
 assert.match(s,/setForegroundRevision\(v=>v\+1\)/);
 assert.match(s,/getStagingGuestAuth\(\)\.currentUser\?\.uid===actor/);
 assert.match(s,/if\(seq\.current===currentRun\)/);
 assert.match(s,/const isCurrent=\(\)=>/);
 assert.match(s,/if\(isCurrent\(\)\)setReviewed/);
 assert.match(s,/setReviewed\(null\);setMessage\(''\);setError\(false\)/);
 assert.match(s,/zoneWatch\.current\?\.stop\(\)/);
 assert.doesNotMatch(s,/AsyncStorage|startLocationUpdatesAsync|TaskManager|scheduleNotificationAsync/);
 const app=read('M2StagingApp.tsx'),eas=read('eas.json');
 assert.match(app,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES==='true'/);
 assert.doesNotMatch(eas,/EXPO_PUBLIC_ENABLE_M4_GEOFENCES/);
});
