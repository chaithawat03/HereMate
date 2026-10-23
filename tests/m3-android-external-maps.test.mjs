import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {androidGeoUri} from '../src/location/androidGeoHandoff.ts';
import {validatedRemoteFix} from '../src/location/m2FriendLocationView.ts';

const T=1_800_000_000_000;
const good=(latitude=13.7563,longitude=100.5018)=>({
 point:{latitude,longitude,accuracyMeters:15,capturedAtMs:T-500},
 expiresAtMs:T+20_000
});
test('Android geo intent is an exact finite coordinate, no identity metadata or URL injection',()=>{
 assert.equal(androidGeoUri(13.7563,100.5018),
   'geo:13.756300,100.501800?q=13.756300,100.501800');
 assert.equal(androidGeoUri(0,0),'geo:0.000000,0.000000?q=0.000000,0.000000');
 assert.equal(androidGeoUri(-90,-180),
   'geo:-90.000000,-180.000000?q=-90.000000,-180.000000');
 assert.equal(androidGeoUri(90,180),
   'geo:90.000000,180.000000?q=90.000000,180.000000');
 for(const pair of [[91,0],[-91,0],[0,181],[0,-181],[NaN,0],
   [Infinity,0],[0,-Infinity],['13.7',100],[null,0],[{},0]])
   assert.equal(androidGeoUri(...pair),null);
 assert.doesNotMatch(androidGeoUri(13,100),/https?:|ownerUid|peerUid|firebase|token/i);
});
test('only server-valid, fresh and accurate friend responses can form map coordinates',()=>{
 assert.equal(androidGeoUri(...((p)=>{
   const fix=validatedRemoteFix(p,T)?.point;
   return fix?[fix.latitude,fix.longitude]:[NaN,NaN];
 })(good())),androidGeoUri(13.7563,100.5018));
 for(const source of [
  {...good(),expiresAtMs:T-1},
  {...good(),point:{...good().point,capturedAtMs:T-50_000}},
  {...good(),point:{...good().point,accuracyMeters:250}},
  {...good(),point:{...good().point,latitude:91}},
  {...good(),point:{...good().point,debug:'extra'}}
 ])assert.equal(validatedRemoteFix(source,T),null);
});
test('Android native handoff requires explicit confirmation and fresh authenticated server re-read',()=>{
 const source=readFileSync(new URL('../src/location/M2FriendLocationPanel.tsx',import.meta.url),'utf8');
 const handoff=readFileSync(new URL('../src/location/androidGeoHandoff.ts',import.meta.url),'utf8');
 assert.match(source,/Platform\.OS==='android'/);
 assert.match(source,/Alert\.alert/);
 assert.match(source,/style:'cancel'/);
 assert.match(source,/transport\.read\(peerUid\)/);
 assert.match(source,/authorizedPeers\(viewerUid,friends\)/);
 assert.match(source,/validatedRemoteFix\(response,Date\.now\(\)\)/);
 assert.match(source,/Linking\.openURL\(uri\)/);
 assert.match(source,/session\.current!==viewerUid/);
 assert.match(source,/AppState\.currentState!=='active'/);
 assert.doesNotMatch(handoff,/AsyncStorage|console\.log|http:|https:|getCurrentPositionAsync|watchPositionAsync/);
});
