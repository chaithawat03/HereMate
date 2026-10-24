import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {iosAppleMapsUri} from '../src/location/iosAppleMapsHandoff.ts';
import {validatedRemoteFix} from '../src/location/m2FriendLocationView.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const T=1_800_000_000_000;
const point=(latitude=13.7563,longitude=100.5018)=>({
  point:{latitude,longitude,accuracyMeters:12,capturedAtMs:T-500},
  expiresAtMs:T+20_000
});

test('iOS Maps URL has fixed Apple HTTPS host and only bounded numeric coordinates',()=>{
  assert.equal(iosAppleMapsUri(13.7563,100.5018),
    'https://maps.apple.com/?ll=13.756300,100.501800');
  assert.equal(iosAppleMapsUri(0,0),'https://maps.apple.com/?ll=0.000000,0.000000');
  assert.equal(iosAppleMapsUri(-90,-180),'https://maps.apple.com/?ll=-90.000000,-180.000000');
  assert.equal(iosAppleMapsUri(90,180),'https://maps.apple.com/?ll=90.000000,180.000000');
  for(const pair of [[91,0],[-91,0],[0,181],[0,-181],[NaN,0],
    [Infinity,0],[0,-Infinity],['13.7',100],[null,0],[{},0],[0,'100.5']])
    assert.equal(iosAppleMapsUri(...pair),null);
  const url=new URL(iosAppleMapsUri(13.7,100.5));
  assert.equal(url.protocol,'https:');
  assert.equal(url.hostname,'maps.apple.com');
  assert.equal(url.pathname,'/');
  assert.equal(url.searchParams.size,1);
  assert.deepEqual([...url.searchParams.keys()],['ll']);
  assert.equal(url.username,'');assert.equal(url.password,'');
  assert.equal(url.hash,'');
  assert.doesNotMatch(url.href,/ownerUid|peerUid|firebase|sessionToken|idToken|auth/i);
});

test('iOS Maps handoff cannot format revoked, stale or inaccurate server location',()=>{
  const accepted=validatedRemoteFix(point(),T);
  assert.ok(accepted);
  assert.equal(iosAppleMapsUri(accepted.point.latitude,accepted.point.longitude),
    'https://maps.apple.com/?ll=13.756300,100.501800');
  for(const response of [
    {...point(),expiresAtMs:T-1},
    {...point(),point:{...point().point,capturedAtMs:T-60_000}},
    {...point(),point:{...point().point,accuracyMeters:250}},
    {...point(),point:{...point().point,latitude:91}},
    {...point(),point:{...point().point,unexpected:'metadata'}}
  ])assert.equal(validatedRemoteFix(response,T),null);
});

test('iOS external map disclosure needs user confirmation, live identity and fresh server ACL re-read',()=>{
  const panel=read('src/location/M2FriendLocationPanel.tsx');
  const ios=read('src/location/M3IOSStagingScreens.tsx');
  const handoff=read('src/location/iosAppleMapsHandoff.ts');
  const eas=JSON.parse(read('eas.json'));
  assert.match(panel,/Platform.OS!=='android'&&Platform.OS!=='ios'/);
  assert.match(panel,/\(Platform.OS==='android'\|\|Platform.OS==='ios'\)\?<Pressable/);
  assert.match(panel,/Alert\.alert\(/);
  assert.match(panel,/style:'cancel'/);
  assert.match(panel,/authorizedPeers\(viewerUid,friends\)/);
  assert.match(panel,/const response=await transport\.read\(peerUid\)/);
  assert.match(panel,/getStagingGuestAuth\(\)\.currentUser\?\.uid!==viewerUid/);
  assert.match(panel,/validatedRemoteFix\(response,Date\.now\(\)\)/);
  assert.match(panel,/iosAppleMapsUri\(/);
  assert.match(panel,/await Linking\.openURL\(uri\)/);
  assert.match(ios,/EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND!=='true'/);
  assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND,undefined);
  assert.doesNotMatch(handoff,/AsyncStorage|console\.log|fetch\(|watchPositionAsync|startLocationUpdatesAsync|TaskManager/);
  assert.doesNotMatch(panel,/maps\.apple\.com\//,
    'only the validated formatter may construct the external Apple Maps URL');
});
