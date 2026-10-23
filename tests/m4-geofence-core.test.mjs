import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 EMPTY_GEOFENCE_STATE,eligibleGeofence,geofenceObservation,stepGeofence,
 circleDistanceMeters,GEOFENCE_EVENT_COOLDOWN_MS
} from '../src/geofences/m4GeofenceCore.ts';

const t=1_800_000_000_000,owner='owner000000000001',subject='friend00000000002';
const relation={senderUid:owner,recipientUid:subject,status:'accepted',
  senderConsent:true,recipientConsent:true};
const definition={id:'circle0000000001',ownerUid:owner,subjectUid:subject,
  latitude:0,longitude:0,radiusMeters:350,
  ownerOptIn:true,subjectOptIn:true,expiresAtMs:t+20_000};
const access={viewerUid:owner,subjectUid:subject,friendship:relation,
  activeGrantVerified:true,grantExpiresAtMs:t+20_000,subjectInForeground:true};
const inside=(at=t)=>({latitude:0,longitude:0,accuracyMeters:15,capturedAtMs:at-500});
const outside=(at=t)=>({latitude:0.02,longitude:0,accuracyMeters:15,capturedAtMs:at-500});
const tick=(previous,fix,now=t,d=definition,a=access)=>
 stepGeofence({definition:d,access:a,previous,fix,nowMs:now});

test('M4 geofence requires accepted relationship AND both M1 and fence opt-ins',()=>{
 assert.equal(eligibleGeofence(definition,access,t),true);
 for(const d of [{...definition,ownerOptIn:false},{...definition,subjectOptIn:false},
   {...definition,radiusMeters:10},{...definition,expiresAtMs:t-1}])
   assert.equal(eligibleGeofence(d,access,t),false);
 for(const a of [{...access,subjectInForeground:false},
   {...access,activeGrantVerified:false},
   {...access,friendship:{...relation,senderConsent:false}},
   {...access,friendship:{...relation,recipientConsent:false}},
   {...access,friendship:{...relation,status:'removed'}},
   {...access,friendship:null},
   {...access,viewerUid:'stranger00000001'},
   {...access,grantExpiresAtMs:t-1}
 ])assert.equal(eligibleGeofence(definition,a,t),false);
 const blocked=tick(EMPTY_GEOFENCE_STATE,inside(),t,definition,
   {...access,activeGrantVerified:false});
 assert.equal(blocked.reason,'blocked');
 assert.strictEqual(blocked.state,EMPTY_GEOFENCE_STATE);
 assert.equal(blocked.event,null);
});
test('not a history feed: no event on initial sighting, two fixes to change zones',()=>{
 const a=tick(EMPTY_GEOFENCE_STATE,outside());
 const b=tick(a.state,outside(),t+1000);
 assert.equal(b.state.zone,'outside');assert.equal(b.event,null);
 const c=tick(b.state,inside(),t+2000);
 assert.equal(c.event,null);assert.equal(c.state.pending,'inside');
 const d=tick(c.state,inside(),t+3000);
 assert.equal(d.state.zone,'inside');assert.equal(d.event,'enter');
 const e=tick(d.state,outside(),t+4000);
 const f=tick(e.state,outside(),t+5000);
 assert.equal(f.state.zone,'outside');assert.equal(f.event,null);
 assert.equal(f.state.lastEventAtMs,t+3000);
 for(const s of [a.state,b.state,c.state,d.state,e.state,f.state]){
   assert.deepEqual(Object.keys(s).sort(),
     ['lastEventAtMs','pending','streak','zone'].sort());
   assert.equal(Object.hasOwn(s,'latitude'),false);
   assert.equal(Object.hasOwn(s,'longitude'),false);
 }
});
test('uncertain boundary, stale, inaccurate and future points produce no events',()=>{
 assert.equal(geofenceObservation(definition,inside(),t),'inside');
 assert.equal(geofenceObservation(definition,outside(),t),'outside');
 assert.equal(geofenceObservation(definition,
   {...inside(),latitude:0.0031,accuracyMeters:60},t),'ambiguous');
 assert.equal(geofenceObservation(definition,
   {...inside(),capturedAtMs:t-60_000},t),'ambiguous');
 assert.equal(geofenceObservation(definition,
   {...inside(),accuracyMeters:500},t),'ambiguous');
 assert.equal(geofenceObservation(definition,
   {...inside(),capturedAtMs:t+10_000},t),'ambiguous');
 const a=tick(EMPTY_GEOFENCE_STATE,outside());
 assert.equal(tick(a.state,{...inside(),accuracyMeters:500}).state.streak,0);
});
test('longitude antimeridian is geographically near, not 360 degrees away',()=>{
 assert.ok(circleDistanceMeters(0,179.99,0,-179.99)<2300);
 assert.equal(Number.isNaN(circleDistanceMeters(91,0,0,0)),true);
});
test('cooldown allows event only after 5 minutes and new reliable samples',()=>{
 const long={...definition,expiresAtMs:t+7*24*60*60_000};
 const fresh={...access,grantExpiresAtMs:t+59_000};
 // First event enters 3 seconds after baseline; 5-minute gap requires
 // a fresh verified short-term lease (server must supply it).
 let x=tick(EMPTY_GEOFENCE_STATE,outside(),t,long,fresh);
 x=tick(x.state,outside(),t+1000,long,fresh);
 x=tick(x.state,inside(),t+2000,long,fresh);
 x=tick(x.state,inside(),t+3000,long,fresh);
 assert.equal(x.event,'enter');
 const later=t+GEOFENCE_EVENT_COOLDOWN_MS+5000;
 const freshAccess={...access,grantExpiresAtMs:later+50_000};
 const y=tick(x.state,outside(later),later,long,freshAccess);
 const z=tick(y.state,outside(later+1000),later+1000,long,freshAccess);
 assert.equal(z.event,'exit');
});
test('offline core is not mobile mounted, no push jobs, persistent GPS log or history',()=>{
 const m=readFileSync(new URL('../src/geofences/m4GeofenceCore.ts',import.meta.url),'utf8');
 assert.doesNotMatch(m,/AsyncStorage|Firestore|expo-notifications|TaskManager|watchPositionAsync/);
 assert.equal(m.includes('setDoc('),false);
 assert.equal(m.includes('addDoc('),false);
 assert.doesNotMatch(readFileSync(new URL('../App.tsx',import.meta.url),'utf8'),/m4GeofenceCore/);
});
