import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  authorizedPeers,validatedRemoteFix,visibleFriendLocations,plotLiveFriends,friendMapStates,
  MAX_VISIBLE_FIX_AGE_MS,MAX_MAP_FRIEND_READS
} from '../src/location/m2FriendLocationView.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const a='owner000000000001',b='friend00000000002',c='friend00000000003',x='stranger000000004';
const now=1_800_000_000_000;
const rel=(peer=b,patch={})=>({
  id:a+'__'+peer,senderUid:a,recipientUid:peer,senderDisplayName:'Me',
  recipientDisplayName:peer===b?'Friend B':'Friend C',status:'accepted',
  senderConsent:true,recipientConsent:true,...patch
});
const point=(lat=13.7,lon=100.5)=>({
 latitude:lat,longitude:lon,accuracyMeters:20,capturedAtMs:now-1_000
});
const readFix=(p=point())=>({point:p,expiresAtMs:now+20_000});
test('accepted, both consented, unique friendship required for map eligibility',()=>{
 assert.deepEqual(authorizedPeers(a,[rel()]),[{uid:b,name:'Friend B'}]);
 assert.deepEqual(authorizedPeers(a,[rel(b),rel(c)]).map(p=>p.uid),[b,c]);
 assert.deepEqual(authorizedPeers(x,[rel()]),[]);
 assert.deepEqual(authorizedPeers(a,[rel(b,{status:'pending'})]),[]);
 assert.deepEqual(authorizedPeers(a,[rel(b,{status:'removed'})]),[]);
 assert.deepEqual(authorizedPeers(a,[rel(b,{senderConsent:false})]),[]);
 assert.deepEqual(authorizedPeers(a,[rel(b,{recipientConsent:false})]),[]);
 assert.deepEqual(authorizedPeers(a,[rel(),rel(b,{id:b+'__'+a})]),[]);
 assert.deepEqual(authorizedPeers(a,[rel(a)]),[]);
});
test('remote shape, limits, expiry and zero/NaN coordinate checks fail closed',()=>{
 assert.deepEqual(validatedRemoteFix(readFix(),now),readFix());
 const invalid=[
  null,{}, {point:point()}, {...readFix(),extra:'debug'},
  {...readFix(),expiresAtMs:now},
  {...readFix(),expiresAtMs:now+MAX_VISIBLE_FIX_AGE_MS+1},
  {...readFix(),expiresAtMs:Infinity},
  readFix({...point(),latitude:91}),
  readFix({...point(),longitude:-181}),
  readFix({...point(),accuracyMeters:201}),
  readFix({...point(),accuracyMeters:NaN}),
  readFix({...point(),capturedAtMs:now-30_001}),
  readFix({...point(),capturedAtMs:now+5_001}),
  readFix({...point(),debug:true}),
 ];
 for(const value of invalid)assert.equal(validatedRemoteFix(value,now),null);
});
test('no locations shown to strangers, expired points, removed friends or consent revoked after prior read',()=>{
 const reads={[b]:readFix(),[x]:readFix(point(14,101))};
 const allowed=visibleFriendLocations({viewerUid:a,relations:[rel()],reads,nowMs:now});
 assert.equal(allowed.length,1);
 assert.equal(allowed[0].peerUid,b);
 assert.deepEqual(visibleFriendLocations({viewerUid:x,relations:[rel()],reads,nowMs:now}),[]);
 assert.deepEqual(visibleFriendLocations({viewerUid:a,relations:[rel(b,{status:'removed'})],reads,nowMs:now}),[]);
 assert.deepEqual(visibleFriendLocations({viewerUid:a,relations:[rel(b,{senderConsent:false})],reads,nowMs:now}),[]);
 assert.deepEqual(visibleFriendLocations({viewerUid:a,relations:[rel()],reads,nowMs:now+30_001}),[]);
});
test('map statuses never mistake missing location for offline or reveal coordinates',()=>{
 const reads={[b]:readFix()};
 assert.equal(friendMapStates({viewerUid:a,relations:[rel()],reads,nowMs:now})[0].status,'LIVE');
 assert.equal(friendMapStates({viewerUid:a,relations:[rel()],reads,nowMs:now+25_000})[0].status,'STALE');
 assert.equal(friendMapStates({viewerUid:a,relations:[rel()],reads:{},nowMs:now})[0].status,'UNAVAILABLE');
 assert.equal(friendMapStates({viewerUid:a,relations:[rel(b,{recipientConsent:false})],reads,nowMs:now})[0].status,'SHARING_OFF');
 assert.deepEqual(friendMapStates({viewerUid:a,relations:[rel(b,{status:'removed'})],reads,nowMs:now}),[]);
 assert.deepEqual(friendMapStates({viewerUid:x,relations:[rel()],reads,nowMs:now}),[]);
 assert.deepEqual(friendMapStates({viewerUid:a,relations:[rel(),rel()],reads,nowMs:now}),[]);
 assert.ok(!JSON.stringify(friendMapStates({viewerUid:a,relations:[rel()],reads,nowMs:now})).includes('latitude'));
 assert.ok(!JSON.stringify(friendMapStates({viewerUid:a,relations:[rel()],reads,nowMs:now})).includes('OFFLINE'));
});
test('deterministic lat/lon projection is finite, bounded and north-facing',()=>{
 const visible=visibleFriendLocations({viewerUid:a,relations:[rel(),rel(c)],
  reads:{[b]:readFix(point(14,100.5)),[c]:readFix(point(13,101))},nowMs:now});
 const pins=plotLiveFriends(visible);
 assert.equal(pins.length,2);
 for(const p of pins){
  assert.ok(p.xPercent>=5&&p.xPercent<=95);
  assert.ok(p.yPercent>=5&&p.yPercent<=95);
  assert.equal(Object.hasOwn(p,'latitude'),false);
  assert.equal(Object.hasOwn(p,'longitude'),false);
 }
 assert.ok(pins[0].yPercent<pins[1].yPercent,'north must be above south');
 assert.ok(pins[0].xPercent<pins[1].xPercent,'west must be left of east');
 assert.deepEqual(plotLiveFriends([]),[]);
 const one=plotLiveFriends(visible.slice(0,1))[0];
 assert.equal(one.xPercent,50);assert.equal(one.yPercent,50);
});
test('antimeridian-nearby points remain next to each other, not a world-spanning canvas',()=>{
 const pins=plotLiveFriends([
  {peerUid:b,displayName:'East',point:point(10,179.95),expiresAtMs:now+10_000},
  {peerUid:c,displayName:'West',point:point(10,-179.95),expiresAtMs:now+10_000},
 ]);
 assert.equal(pins.length,2);
 assert.ok(pins[0].xPercent<pins[1].xPercent);
 assert.equal(pins[0].yPercent,pins[1].yPercent);
});
test('model and dormant React panel do not query open location collections or publish GPS',()=>{
 const app=read('App.tsx'),eas=JSON.parse(read('eas.json'));
 const panel=read('src/location/M2FriendLocationPanel.tsx');
 const model=read('src/location/m2FriendLocationView.ts');
 const scoped=read('src/location/accountScopedFriendMapRead.ts');
 assert.doesNotMatch(app,/M2FriendLocationPanel|EXPO_PUBLIC_ENABLE_M2_MAP/);
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M2_MAP,undefined);
 assert.match(panel,/backendReviewedAndEnabled/);
 assert.match(panel,/onAuthStateChanged/);
 assert.match(panel,/AppState\.addEventListener/);
 assert.match(panel,/setPositions\(\{\}\)/);
 assert.match(panel,/loadAuthorizedFriendMap/);
 assert.match(scoped,/Promise\.allSettled/);
 assert.match(scoped,/MAX_MAP_FRIEND_READS/);
 assert.match(panel,/visibleFriendLocations/);
 assert.match(panel,/clear\(\)/);
 assert.match(model,/relation\.senderConsent!==true\|\|relation\.recipientConsent!==true/);
 assert.equal(MAX_MAP_FRIEND_READS,8);
 assert.doesNotMatch(model+panel+scoped,/getDocs\(|collection\(|onSnapshot|watchPositionAsync|setDoc\(|fetch\(|https?:\/\/|AsyncStorage|console\.log/);
});
