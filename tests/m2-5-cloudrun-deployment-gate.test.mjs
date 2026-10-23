import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 assertM2CloudPreflight,M2_PROJECT,M2_REGION,M2_RUNTIME,M2_BUILD,M2_DEPLOY,
 M2_COLLECTIONS
} from '../scripts/m2-staging-gcp-verify.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const actor=email=>'serviceAccount:'+email;
function rig(){
 const binding=(role,members)=>({role,members});
 const project={bindings:[
  binding('roles/datastore.user',[actor(M2_RUNTIME)]),
  binding('roles/firebaseauth.viewer',[actor(M2_RUNTIME)]),
  binding('roles/run.admin',[actor(M2_DEPLOY)]),
  binding('roles/cloudbuild.builds.editor',[actor(M2_DEPLOY)]),
  binding('roles/logging.logWriter',[actor(M2_BUILD)]),
 ]};
 const ttl=M2_COLLECTIONS.map(g=>({
  name:'projects/heremate/databases/(default)/collectionGroups/'+g+'/fields/expireAt',
  ttlConfig:{state:'ACTIVE'}
 }));
 const runtimePolicy={bindings:[
  binding('roles/iam.serviceAccountUser',[actor(M2_DEPLOY)])
 ]};
 const buildPolicy={bindings:[
  binding('roles/iam.serviceAccountUser',[actor(M2_DEPLOY)])
 ]};
 const artifactPolicy={bindings:[
  binding('roles/artifactregistry.writer',[actor(M2_BUILD)])
 ]};
 return {project:M2_PROJECT,region:M2_REGION,billing:true,
  policy:project,ttl,runtimePolicy,buildPolicy,artifactPolicy};
}
test('approved project IAM, distinct runtime/build/deploy principals and ACTIVE TTL pass',()=>{
 const r=rig();const checked=assertM2CloudPreflight(r);
 assert.equal(checked.ttlActive,4);
 assert.equal(checked.project,'heremate');
 assert.equal(checked.region,'asia-southeast1');
});
test('reject wrong GCP target, billing OFF, missing roles, editor and nonactive TTL',()=>{
 const r=rig();
 for(const update of [
  {project:'prod'},
  {region:'us-central1'},
  {billing:false},
  {billing:null},
  {policy:{bindings:r.policy.bindings.filter(x=>x.role!=='roles/firebaseauth.viewer')}},
  {policy:{bindings:[...r.policy.bindings,{role:'roles/editor',members:[actor(M2_RUNTIME)]}]}},
  {runtimePolicy:{bindings:[]}},
  {buildPolicy:{bindings:[]}},
  {artifactPolicy:{bindings:[]}},
  {artifactPolicy:{bindings:[{role:'roles/artifactregistry.writer',
    members:[actor(M2_RUNTIME)]}]}},
  {policy:{bindings:[...r.policy.bindings,{
    role:'roles/artifactregistry.writer',members:[actor(M2_BUILD)]}]}},
  {buildPolicy:{bindings:[{role:'roles/iam.serviceAccountUser',
     members:[actor(M2_RUNTIME)]}]}},
  {ttl:r.ttl.filter(x=>!x.name.includes('private_location_grants'))},
  {ttl:r.ttl.map((x,i)=>i===0?{...x,name:'projects/other-project'+
     x.name.slice('projects/heremate'.length)}:x)},
  {ttl:r.ttl.map((x,i)=>i===0?{...x,ttlConfig:{state:'CREATING'}}:x)}
 ]) assert.throws(()=>assertM2CloudPreflight({...r,...update}),/M2_GCP_PREFLIGHT_BLOCKED/);
});
test('new Cloud Run workflow is manual-only, guarded by GitHub variables and review environment',()=>{
 const workflow=read('.github/workflows/m2-staging-cloudrun.yml');
 const cloud=read('scripts/m2-staging-cloudrun-deploy.sh');
 const preflight=read('scripts/m2-staging-gcp-preflight.sh');
 const old=read('.github/workflows/staging-eas-build.yml');
 assert.match(workflow,/^  workflow_dispatch:/m);
 assert.doesNotMatch(workflow,/^  push:|^  schedule:/m);
 assert.match(workflow,/environment: m2-staging-deploy/);
 assert.match(workflow,/vars.M2_STAGING_DEPLOY_ENABLED == 'true'/);
 assert.match(workflow,/vars.M2_STAGING_WIF_TRUST_REVIEWED == 'true'/);
 assert.match(workflow,/inputs.confirm_target == 'heremate\/asia-southeast1\/M2-Staging'/);
 assert.match(workflow,/service_account: \$\{\{ vars.M2_STAGING_DEPLOY_SERVICE_ACCOUNT \}\}/);
 assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/verify-release.mjs verify-merge/);
 assert.ok(workflow.includes('heremate-m2-staging/providers/github-m2-staging'));
 assert.ok(!workflow.includes('workloadIdentityPools/*/providers/*'));
 assert.match(cloud,/--no-invoker-iam-check/);
 assert.match(cloud,/--min=0 --max=1 --concurrency=4/);
 assert.match(cloud,/--service-account='heremate-m2-runtime@heremate.iam.gserviceaccount.com'/);
 assert.match(cloud,/--region=asia-southeast1/);
 assert.match(cloud,/--invoker-iam-check/);
 assert.match(cloud,/trap rollback_on_failure EXIT/);
 assert.match(cloud,/scripts\/m2-4-readonly-cloudrun-smoke.mjs/);
 assert.match(preflight,/m2-staging-gcp-verify.mjs/);
 assert.ok(preflight.includes('build-policy.json'));
 assert.ok(preflight.includes('artifact-policy.json'));
 assert.ok(preflight.includes('artifacts repositories get-iam-policy'));
 assert.ok(preflight.includes('heremate-m2-build@heremate.iam.gserviceaccount.com'));
 assert.match(old,/^  push:/m);
 assert.doesNotMatch(workflow+cloud+preflight,/gcloud iam service-accounts create|gcloud projects add-iam-policy-binding|gcloud firestore fields ttls update|EXPO_TOKEN|GOOGLE_DRIVE_REFRESH_TOKEN/);
});
