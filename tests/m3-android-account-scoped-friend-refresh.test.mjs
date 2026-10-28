import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAccountScopedFriendRefresh} from '../src/location/accountScopedFriendRefresh.ts';

const A='androidowneraccount0001',B='androidsecondaccount002';
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
function rig(){
 let who=A,foreground=true;
 const gate=createAccountScopedFriendRefresh({
   currentUid:()=>who,isForeground:()=>foreground
 });
 const commits=[],failures=[];
 return {gate,commits,failures,
   get who(){return who;},
   setUid:u=>{who=u;},setForeground:v=>{foreground=v;},
   run:load=>gate.run(load,(entries,uid)=>commits.push({entries,uid}),
     ()=>failures.push(who))
 };
}
test('one authenticated user receives only the response from their own active refresh',async()=>{
 const x=rig();
 assert.equal(await x.run(async()=>['friend-A']),true);
 assert.deepEqual(x.commits,[{entries:['friend-A'],uid:A}]);
 assert.equal(x.failures.length,0);
});
test('an old account response cannot repopulate friends after account switch',async()=>{
 const x=rig();
 let release;
 const promise=new Promise(resolve=>{release=resolve;});
 const old=x.run(()=>promise);
 await flush();
 x.setUid(B);
 x.gate.invalidate();
 const next=x.run(async()=>['new-B']);
 release(['old-A']);
 assert.equal(await old,false);
 assert.equal(await next,true);
 assert.deepEqual(x.commits,[{entries:['new-B'],uid:B}]);
});
test('direct auth switch without callback still rejects old account response',async()=>{
 const x=rig();
 let release;
 const old=x.run(()=>new Promise(resolve=>{release=resolve;}));
 await flush();
 x.setUid(B);
 release(['old-A']);
 assert.equal(await old,false);
 assert.deepEqual(x.commits,[]);
});
test('background, signout and unmount discard late name reads and errors',async()=>{
 for(const incident of ['background','signout','invalidate','unmount']){
   const x=rig();
   let release,reject;
   const gate=new Promise((resolve,fail)=>{release=resolve;reject=fail;});
   const previous=x.run(()=>gate);
   await flush();
   if(incident==='background')x.setForeground(false);
   if(incident==='signout')x.setUid(null);
   if(incident==='invalidate')x.gate.invalidate();
   if(incident==='unmount')x.gate.dispose();
   release(['forbidden-old-friend']);
   assert.equal(await previous,false);
   assert.deepEqual(x.commits,[]);
   assert.deepEqual(x.failures,[]);
 }
});
test('last user-initiated refresh wins over older out-of-order response',async()=>{
 const x=rig();let firstDone;
 const first=x.run(()=>new Promise(resolve=>{firstDone=resolve;}));
 const second=x.run(async()=>['newer']);
 firstDone(['older']);
 assert.equal(await first,false);
 assert.equal(await second,true);
 assert.deepEqual(x.commits,[{uid:A,entries:['newer']}]);
});
test('only active account errors are surfaced',async()=>{
 const x=rig();
 assert.equal(await x.run(async()=>{throw Error('unavailable');}),false);
 assert.deepEqual(x.failures,[A]);
 x.gate.dispose();
 assert.equal(await x.run(async()=>['never']),false);
 assert.equal(x.commits.length,0);
});
test('Android sharing UI invalidates names, selected friend and emergency result on account loss',()=>{
 const s=readFileSync(new URL('../src/location/M2SharingPanel.tsx',import.meta.url),'utf8');
 assert.match(s,/createAccountScopedFriendRefresh/);
 assert.match(s,/gate\.invalidate\(\)/);
 assert.match(s,/gate\.dispose\(\)/);
 assert.match(s,/setFriends\(\[\]\);setSelectedUid\(null\)/);
 assert.match(s,/authSession\.current!==u/);
 assert.match(s,/sameEmergencyAuthSession\(startingSession,/);
 assert.match(s,/const own=entries\.filter\(r=>r\.senderUid===uid\|\|r\.recipientUid===uid\)/);
 assert.match(s,/controller\.current\?\.consentChanged/);
});
