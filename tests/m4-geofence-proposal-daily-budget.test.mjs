import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createFirestoreGeofenceRateLimiter,GEOFENCE_WINDOW_MS,
  GEOFENCE_ROUTE_LIMITS,GEOFENCE_PROPOSE_DAY_MS,GEOFENCE_PROPOSE_DAY_LIMIT
} from '../backend/geofences/geofence-rate-limiter.mjs';
import {GeofenceBusy} from '../backend/geofences/geofence-service.mjs';

const A='zoneowneruid000001',B='zonesubjectuid0002',START=1_800_000_000_000;
const key=(route,actor)=>createHash('sha256')
  .update('m4-geofence:v1:'+route+':'+actor).digest('hex');
function rig(){
  let now=START,writes=0;
  const rows=new Map();
  const db={
    projectId:'heremate',
    collection:name=>{
      assert.equal(name,'private_geofence_rate_limits');
      return {doc:id=>({id})};
    },
    runTransaction:async work=>{
      const staged=[];
      const tx={
        get:async ref=>({
          exists:rows.has(ref.id),
          data:()=>rows.get(ref.id)
        }),
        set:(ref,value)=>staged.push([ref.id,value])
      };
      const result=await work(tx);
      for(const [id,row] of staged){rows.set(id,row);writes++;}
      return result;
    }
  };
  const limiter=createFirestoreGeofenceRateLimiter(db,()=>now);
  return {limiter,rows,key,
    now:()=>now,setTime:value=>{now=value;},
    writes:()=>writes
  };
}
test('M4 proposal budget bounds writes across 24 distinct minute windows',async()=>{
  const x=rig();
  for(let i=0;i<GEOFENCE_PROPOSE_DAY_LIMIT;i++){
    x.setTime(START+i*(GEOFENCE_WINDOW_MS+1));
    assert.equal(await x.limiter.consume({actor:A,route:'propose'}),true);
  }
  const before=x.writes();
  x.setTime(START+GEOFENCE_PROPOSE_DAY_LIMIT*(GEOFENCE_WINDOW_MS+1));
  assert.equal(await x.limiter.consume({actor:A,route:'propose'}),false);
  assert.equal(x.writes(),before,'daily rejection must not create a Firestore write');
  const row=x.rows.get(key('propose',A));
  assert.equal(row.dayCount,GEOFENCE_PROPOSE_DAY_LIMIT);
  assert.equal(row.dayStartedAtMs,START);
  assert.ok(row.expireAt instanceof Date);
  assert.ok(row.expireAt.getTime()>=START+GEOFENCE_PROPOSE_DAY_MS);
  assert.equal(x.rows.size,1,'same hashed document, no new collection or identity keys');
  assert.equal([...x.rows.keys()][0].includes(A),false);
  assert.equal(Object.hasOwn(row,'latitude'),false);
  assert.equal(Object.hasOwn(row,'longitude'),false);
});
test('a new 24h window resets proposal budget without a Firestore TTL deletion',async()=>{
  const x=rig();
  for(let i=0;i<GEOFENCE_PROPOSE_DAY_LIMIT;i++){
    x.setTime(START+i*(GEOFENCE_WINDOW_MS+1));
    assert.equal(await x.limiter.consume({actor:A,route:'propose'}),true);
  }
  x.setTime(START+GEOFENCE_PROPOSE_DAY_MS);
  assert.equal(await x.limiter.consume({actor:A,route:'propose'}),true);
  const row=x.rows.get(key('propose',A));
  assert.equal(row.dayCount,1);
  assert.equal(row.dayStartedAtMs,START+GEOFENCE_PROPOSE_DAY_MS);
  assert.ok(row.expireAt.getTime()>=START+2*GEOFENCE_PROPOSE_DAY_MS);
});
test('existing per-minute rate limit and per-actor isolation remain enforced',async()=>{
  const x=rig();
  for(let i=0;i<GEOFENCE_ROUTE_LIMITS.propose;i++)
    assert.equal(await x.limiter.consume({actor:A,route:'propose'}),true);
  assert.equal(await x.limiter.consume({actor:A,route:'propose'}),false);
  assert.equal(await x.limiter.consume({actor:B,route:'propose'}),true);
  x.setTime(START+GEOFENCE_WINDOW_MS+1);
  assert.equal(await x.limiter.consume({actor:A,route:'propose'}),true);
  assert.equal(x.rows.get(key('propose',A)).dayCount,
    GEOFENCE_ROUTE_LIMITS.propose+1);
  assert.equal(x.rows.get(key('propose',B)).dayCount,1);
});
test('review/evaluate existing minute limits are not silently given proposal budget',async()=>{
  const x=rig();
  for(let window=0;window<26;window++){
    x.setTime(START+window*(GEOFENCE_WINDOW_MS+1));
    for(let i=0;i<GEOFENCE_ROUTE_LIMITS.review;i++)
      assert.equal(await x.limiter.consume({actor:A,route:'review'}),true);
    assert.equal(await x.limiter.consume({actor:A,route:'review'}),false);
  }
  const row=x.rows.get(key('review',A));
  assert.equal(Object.hasOwn(row,'dayCount'),false);
  assert.equal(Object.hasOwn(row,'dayStartedAtMs'),false);
});
test('legacy minute-only proposal row migrates without dropping active minute quota',async()=>{
  const x=rig(),id=key('propose',A);
  x.rows.set(id,{count:2,windowStartedAtMs:START-1000,
    expireAt:new Date(START+GEOFENCE_PROPOSE_DAY_MS)});
  assert.equal(await x.limiter.consume({actor:A,route:'propose'}),true);
  assert.equal(x.rows.get(id).count,3);
  assert.equal(x.rows.get(id).dayCount,1);
  assert.equal(await x.limiter.consume({actor:A,route:'propose'}),true);
  assert.equal(await x.limiter.consume({actor:A,route:'propose'}),false);
});
test('partial, corrupt or future-dated daily counter fails closed without writes',async()=>{
  const x=rig(),id=key('propose',A);
  const base={count:1,windowStartedAtMs:START-1000,
    expireAt:new Date(START+GEOFENCE_PROPOSE_DAY_MS)};
  for(const patch of [
    {dayCount:1},{dayStartedAtMs:START},
    {dayStartedAtMs:START+1,dayCount:1},
    {dayStartedAtMs:START,dayCount:0},
    {dayStartedAtMs:START,dayCount:1.5},
    {dayStartedAtMs:START,dayCount:Infinity}
  ]){
    x.rows.set(id,{...base,...patch});
    const before=x.writes();
    await assert.rejects(x.limiter.consume({actor:A,route:'propose'}),GeofenceBusy);
    assert.equal(x.writes(),before);
  }
});
