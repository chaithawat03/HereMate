/**
 * Pure M2 Staging GCP read-only preflight validator.
 * Uses observed GCP output, never authenticates or changes resources.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const M2_PROJECT='heremate';
export const M2_REGION='asia-southeast1';
export const M2_SERVICE='heremate-m2-location-staging';
export const M2_RUNTIME='heremate-m2-runtime@heremate.iam.gserviceaccount.com';
export const M2_DEPLOY='heremate-m2-deploy@heremate.iam.gserviceaccount.com';
export const M2_BUILD='heremate-m2-build@heremate.iam.gserviceaccount.com';
export const M2_COLLECTIONS=Object.freeze([
 'private_location_grants','private_latest_locations',
 'private_location_rate_limits','private_location_publishers'
]);
const block=reason=>{throw Error('M2_GCP_PREFLIGHT_BLOCKED: '+reason);};
const bindingsFor=(policy,member)=>new Set(
 (policy?.bindings||[]).filter(x=>Array.isArray(x.members)&&
 x.members.includes(member)&&!x.condition).map(x=>x.role)
);
export function assertM2CloudPreflight({project,region,billing,policy,ttl,runtimePolicy}){
 if(project!==M2_PROJECT||region!==M2_REGION)block('project or region mismatch');
 if(billing!==true)block('GCP billing is disabled or unreadable');
 if(!policy||!Array.isArray(policy.bindings))block('project IAM unavailable');
 const runtime=bindingsFor(policy,'serviceAccount:'+M2_RUNTIME);
 const deploy=bindingsFor(policy,'serviceAccount:'+M2_DEPLOY);
 const build=bindingsFor(policy,'serviceAccount:'+M2_BUILD);
 for(const role of ['roles/datastore.user','roles/firebaseauth.viewer'])
   if(!runtime.has(role))block('runtime missing '+role);
 for(const role of ['roles/run.admin','roles/cloudbuild.builds.editor'])
   if(!deploy.has(role))block('dedicated deploy identity missing '+role);
 for(const role of ['roles/artifactregistry.writer','roles/logging.logWriter'])
   if(!build.has(role))block('dedicated build identity missing '+role);
 for(const [actor,roles] of [['runtime',runtime],['build',build],['deploy',deploy]]){
   if(roles.has('roles/owner')||roles.has('roles/editor')||
      roles.has('roles/datastore.owner'))
     block('overprivileged '+actor+' identity');
 }
 if(!bindingsFor(runtimePolicy,'serviceAccount:'+M2_DEPLOY)
   .has('roles/iam.serviceAccountUser'))
   block('deploy identity cannot attach dedicated runtime identity');
 if(!Array.isArray(ttl))block('Firestore TTL list unavailable');
 for(const group of M2_COLLECTIONS){
   const matching=ttl.filter(x=>
    typeof x?.name==='string'&&
    x.name.includes('/databases/(default)/collectionGroups/'+group+'/fields/expireAt'));
   if(matching.length!==1 || matching[0]?.ttlConfig?.state!=='ACTIVE')
     block('Firestore expireAt TTL not ACTIVE for '+group);
 }
 return Object.freeze({project:M2_PROJECT,region:M2_REGION,
   runtimeRoleCount:runtime.size,ttlActive:M2_COLLECTIONS.length,
   approvedNetwork:'Firebase ID-token-verified public HTTPS only'});
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try {
   const files=process.argv.slice(2);
   if(files.length!==4)block('four reviewed read-only input snapshots required');
   const [billing,policy,ttl,runtimePolicy]=files.map(p=>JSON.parse(readFileSync(p,'utf8')));
   const result=assertM2CloudPreflight({
     project:process.env.M2_GCP_PROJECT,region:process.env.M2_GCP_REGION,
     billing:billing.billingEnabled,policy,ttl,runtimePolicy
   });
   // Never emit principal details, project IAM bindings or credentials.
   process.stdout.write(JSON.stringify(result)+'\n');
 }catch {
   process.stderr.write('M2_GCP_PREFLIGHT_BLOCKED: see owner-approved IAM/TTL prerequisites\n');
   process.exitCode=1;
 }
}
