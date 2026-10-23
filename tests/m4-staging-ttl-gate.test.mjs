import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertM4TTLPreflight,M4_COLLECTIONS}
  from '../scripts/m4-staging-ttl-verify.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ttl=M4_COLLECTIONS.map(c=>({
 name:'projects/heremate/databases/(default)/collectionGroups/'+c+
  '/fields/expireAt',ttlConfig:{state:'ACTIVE'}
}));
test('M4 verifies exactly three ACTIVE Staging collection-group expireAt TTLs',()=>{
 const result=assertM4TTLPreflight({
   project:'heremate',region:'asia-southeast1',ttl
 });
 assert.equal(result.verifiedPolicies,3);
 for(const wrong of [
  {project:'production'},{region:'us-central1'},{ttl:[]},
  {ttl:null},{ttl:ttl.slice(1)}, {ttl:[...ttl,ttl[0]]},
  {ttl:ttl.map((x,i)=>i===1?{...x,ttlConfig:{state:'CREATING'}}:x)},
  {ttl:ttl.map((x,i)=>i===2?{...x,name:x.name.replace('/expireAt','/createdAt')}:x)},
  {ttl:ttl.map((x,i)=>i===0?{...x,name:x.name.replace('heremate','wrong')}:x)}
 ])assert.throws(()=>assertM4TTLPreflight({
    project:'heremate',region:'asia-southeast1',ttl,...wrong
  }),/M4_TTL_PREFLIGHT_BLOCKED/);
});
test('TTL preflight only reads policies; never updates GCP resources',()=>{
 const shell=read('scripts/m4-staging-ttl-preflight.sh');
 assert.match(shell,/fields ttls list/);
 assert.match(shell,/project=heremate/);
 assert.match(shell,/database='\(default\)'/);
 assert.match(shell,/m4-staging-ttl-verify\.mjs/);
 assert.doesNotMatch(shell,/gcloud (?:run deploy|firestore fields ttls update|projects add-iam-policy-binding|iam service-accounts create)/);
});
test('M4 runtime is opt-in and excluded from all existing build/deploy flags',()=>{
 const main=read('backend/location-runtime/main.mjs');
 const docker=read('backend/location-runtime/Dockerfile');
 const workflow=read('.github/workflows/m2-staging-cloudrun.yml');
 const script=read('scripts/m2-staging-cloudrun-deploy.sh');
 assert.match(main,/HEREMATE_M4_ENABLE_SERVER==='true'/);
 assert.match(main,/HEREMATE_M4_TTL_REVIEWED!=='true'/);
 assert.match(main,/HEREMATE_M4_BUDGET_REVIEWED!=='true'/);
 assert.match(main,/createStagingRouteHandler/);
 assert.match(main,/createNodeGeofenceHandler/);
 assert.match(main,/createFirestoreGeofenceRateLimiter/);
 assert.match(docker,/COPY backend\/geofences\/geofence-policy\.mjs/);
 assert.doesNotMatch(script,/HEREMATE_M4_ENABLE_SERVER/);
 assert.doesNotMatch(workflow,/HEREMATE_M4_ENABLE_SERVER/);
 assert.doesNotMatch(read('eas.json'),/EXPO_PUBLIC_ENABLE_M4_GEOFENCES/);
 assert.doesNotMatch(read('.github/workflows/android-m2-native-staging-apk.yml'),
  /EXPO_PUBLIC_ENABLE_M4_GEOFENCES/);
});
