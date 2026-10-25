/** M4 dormant Staging: a malformed persisted zone is never a safe replacement target.
 * All tests are offline; no Firebase credentials, GPS, or live writes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeofenceService,GeofenceDenied} from '../backend/geofences/geofence-service.mjs';
import {STAGING_PROJECT} from '../backend/location/location-service.mjs';

const owner='zoneowneruid000001',subject='zonesubjectuid0002';
const now=1_800_000_000_000;
const circle={latitude:0,longitude:0,radiusMeters:350};
const token=uid=>'T'.repeat(64)+uid;
const accepted={
  senderUid:owner,recipientUid:subject,status:'accepted',
  senderConsent:true,recipientConsent:true,
  updatedAt:{seconds:1_800_000_000,nanoseconds:0}
};
const original={
  ownerUid:owner,subjectUid:subject,status:'active',circle,
  createdAtMs:now-100_000,approvedAtMs:now-90_000,
  relationRevision:'1799999999:0',expiresAtMs:now-1
};

function fixture(){
 let zone=null,relation=accepted,state={zone:'inside'};
 const writes=[];
 const store={
  projectId:STAGING_PROJECT,
  async transactZone(pair,work){
   assert.deepEqual(pair,{ownerUid:owner,subjectUid:subject});
   const pending=[];
   const result=await work({
    relation,zone,state,
    setZone:value=>pending.push(['setZone',value]),
    deleteZone:()=>pending.push(['deleteZone']),
    setState:value=>pending.push(['setState',value]),
    deleteState:()=>pending.push(['deleteState'])
   });
   for(const [op,value] of pending){
    writes.push(op);
    if(op==='setZone')zone=value;
    if(op==='deleteZone')zone=null;
    if(op==='setState')state=value;
    if(op==='deleteState')state=null;
   }
   return result;
  }
 };
 const auth={
  app:{options:{projectId:STAGING_PROJECT}},
  async verifyIdToken(value,revoked){
   assert.equal(revoked,true);
   const uid=value.slice(64);
   if(!value.startsWith('T'.repeat(64))||![owner,subject].includes(uid))
     throw Error('invalid test bearer');
   return {uid,sub:uid,aud:STAGING_PROJECT,
    iss:'https://securetoken.google.com/'+STAGING_PROJECT};
  }
 };
 const limiter={persistent:true,async consume(){return true;}};
 const service=createGeofenceService({
  adminAuth:auth,store,rateLimiter:limiter,clock:()=>now
 });
 return {
  service,writes,
  setZone:value=>{zone=value;},
  getZone:()=>zone,
  getState:()=>state,
  setRelation:value=>{relation=value;}
 };
}

test('M4 PROPOSE denies malformed or live persisted zones without ANY mutation',async()=>{
 const f=fixture();
 const cases=[
  ['missing expiry',(()=>{const z={...original};delete z.expiresAtMs;return z;})()],
  ['null expiry',{...original,expiresAtMs:null}],
  ['string expiry',{...original,expiresAtMs:String(now-1)}],
  ['NaN expiry',{...original,expiresAtMs:NaN}],
  ['fractional expiry',{...original,expiresAtMs:now-0.5}],
  ['unsafe integer expiry',{...original,expiresAtMs:Number.MAX_SAFE_INTEGER+1}],
  ['negative expiry',{...original,expiresAtMs:-1}],
  ['unknown status',{...original,status:'revoked'}],
  ['malformed circle',{...original,circle:{...circle,radiusMeters:5}}],
  // Expired but corrupt approval provenance must not be erased by PROPOSE.
  // Live-zone REVIEW/EVALUATE checks alone do not cover this write path.
  ['missing creation',{...original,createdAtMs:undefined}],
  ['fractional creation',{...original,createdAtMs:now-100_000.5}],
  ['future creation',{...original,createdAtMs:now+1}],
  ['creation after expiry',{...original,createdAtMs:now}],
  ['missing approval',{...original,approvedAtMs:undefined}],
  ['fractional approval',{...original,approvedAtMs:now-90_000.5}],
  ['approval before creation',{...original,approvedAtMs:now-100_001}],
  ['future approval',{...original,approvedAtMs:now+1}],
  ['approval beyond pending lifetime',{
    ...original,createdAtMs:now-90_000_000,approvedAtMs:now-90_000
  }],
  ['expired before approval',{...original,approvedAtMs:now}],
  ['active expiry exceeds seven-day lifetime',{
    ...original,createdAtMs:now-8*86_400_000-1000,
    approvedAtMs:now-8*86_400_000
  }],
  ['expired pending beyond 24-hour lifetime',{
    ...original,status:'pending',createdAtMs:now-2*86_400_000,
    approvedAtMs:undefined
  }],
  ['expired pending missing creation',{
    ...original,status:'pending',createdAtMs:undefined,approvedAtMs:undefined
  }],
  ['unexpired active zone',{...original,expiresAtMs:now+1000}]
 ];
 for(const [label,record] of cases){
  f.setZone(record);
  f.writes.length=0;
  await assert.rejects(
   f.service.propose({idToken:token(owner),subjectUid:subject,circle}),
   GeofenceDenied,label);
  assert.strictEqual(f.getZone(),record,label+' must preserve the original record');
  assert.deepEqual(f.writes,[],label+' must not delete dedupe or write zone');
 }
});

test('a valid expired zone is replaceable; a corrupt zone remains independently revocable',async()=>{
 const f=fixture();
 f.setZone({...original});
 const proposed=await f.service.propose({
  idToken:token(owner),subjectUid:subject,circle
 });
 assert.equal(proposed.proposed,true);
 assert.equal(f.getZone().status,'pending');
 assert.equal(f.getZone().expiresAtMs>now,true);
 assert.equal(f.getZone().approvedAtMs,undefined);
 assert.equal(f.getState(),null);
 assert.deepEqual(f.writes,['setZone','deleteState']);
 // Even when the friendship is removed, the tracked subject can revoke a
 // malformed zone rather than being forced to overwrite it via PROPOSE.
 f.setZone({...original,expiresAtMs:'corrupt'});
 f.setRelation(null);
 f.writes.length=0;
 assert.deepEqual(await f.service.revoke({
  idToken:token(subject),ownerUid:owner,subjectUid:subject
 }),{revoked:true});
 assert.equal(f.getZone(),null);
 assert.deepEqual(f.writes,['deleteZone']);
});
