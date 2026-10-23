/**
 * Read-only M4 Staging ACTIVE TTL gate. Does not modify Firestore policies,
 * IAM, Cloud Run or user data.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const M4_COLLECTIONS=Object.freeze([
 'private_geofence_zones','private_geofence_states',
 'private_geofence_rate_limits'
]);
const deny=r=>{throw Error('M4_TTL_PREFLIGHT_BLOCKED: '+r);};
export function assertM4TTLPreflight({project,region,ttl}){
 if(project!=='heremate'||region!=='asia-southeast1')
   deny('wrong project or region');
 if(!Array.isArray(ttl))deny('no trusted TTL list');
 for(const collection of M4_COLLECTIONS){
   const expected='projects/heremate/databases/(default)/collectionGroups/'+
     collection+'/fields/expireAt';
   const matched=ttl.filter(record=>record?.name===expected);
   if(matched.length!==1||matched[0]?.ttlConfig?.state!=='ACTIVE')
     deny('expireAt TTL not ACTIVE for '+collection);
 }
 return Object.freeze({
   project:'heremate',region:'asia-southeast1',
   verifiedPolicies:M4_COLLECTIONS.length,
   collections:[...M4_COLLECTIONS]
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
   const file=process.argv[2];
   if(!file||process.argv.length!==3)deny('one read-only JSON snapshot required');
   const rows=JSON.parse(readFileSync(file,'utf8'));
   const result=assertM4TTLPreflight({
     project:process.env.M4_GCP_PROJECT,region:process.env.M4_GCP_REGION,
     ttl:rows
   });
   process.stdout.write('M4_TTL_PREFLIGHT_PASS: '+
     result.verifiedPolicies+' ACTIVE expireAt policies (read-only)\n');
 }catch{
   process.stderr.write('M4_TTL_PREFLIGHT_BLOCKED: review 3 ACTIVE expireAt policies\n');
   process.exitCode=1;
 }
}
