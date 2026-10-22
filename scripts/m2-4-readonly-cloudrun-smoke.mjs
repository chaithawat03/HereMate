/**
 * M2.4E read-only Cloud Run surface smoke. NO authenticated test account,
 * NO Location Start/Publish/Stop, NO GPS coordinates and NO resource changes.
 *
 * Run manually only AFTER Issue #43 records owner approval and a reviewed
 * Staging-only service deployment; never use Production or arbitrary hosts.
 */
import {fileURLToPath} from 'node:url';

const SERVICE='heremate-m2-location-staging-';
const E=(s)=>{throw Error('M2_STAGING_SMOKE_BLOCKED: '+s);};
const UNTRUSTED='this.is.not.a.valid.firebase.jwt.token.00000000000000000000';
const PATH='/v1/locations/points/read';
const SAFE_BODY=JSON.stringify({ownerUid:'no_real_account_000001'});

export function validateM2SmokeOrigin(input) {
  if(typeof input!=='string')E('missing approved HTTPS origin');
  let u;
  try{u=new URL(input);}catch{E('malformed HTTPS origin');}
  if(u.protocol!=='https:'||!u.hostname.startsWith(SERVICE)||
     !u.hostname.endsWith('.run.app')||u.username||u.password||
     u.port||u.pathname!=='/'||u.search||u.hash)
    E('not the named Cloud Run Staging service');
  return u.origin;
}

const probes=Object.freeze([
  {name:'missing bearer is denied',method:'POST',path:PATH,token:null,
    type:'application/json',body:SAFE_BODY,status:401},
  {name:'malformed bearer is denied',method:'POST',path:PATH,token:'bad',
    type:'application/json',body:SAFE_BODY,status:401},
  {name:'forged bearer cannot read',method:'POST',path:PATH,token:UNTRUSTED,
    type:'application/json',body:SAFE_BODY,status:404},
  {name:'wrong HTTP method is denied',method:'GET',path:PATH,token:UNTRUSTED,
    type:'application/json',status:405},
  {name:'wrong media type is denied',method:'POST',path:PATH,token:UNTRUSTED,
    type:'text/plain',body:SAFE_BODY,status:415},
  {name:'oversized body is denied',method:'POST',path:PATH,token:UNTRUSTED,
    type:'application/json',body:'x'.repeat(1025),status:413},
  {name:'query argument is rejected',method:'POST',path:PATH+'?unexpected=1',
    token:UNTRUSTED,type:'application/json',body:SAFE_BODY,status:404}
]);

export async function runM2ReadOnlySmoke({origin,fetchImpl=fetch,consent=false}) {
  if(consent!==true)E('explicit approved staging smoke required');
  const url=validateM2SmokeOrigin(origin);
  if(typeof fetchImpl!=='function')E('invalid HTTPS transport');
  const results=[];
  for(const item of probes){
    const headers={'Accept':'application/json',
      'Content-Type':item.type,'Cache-Control':'no-store'};
    if(item.token!==null)headers.Authorization='Bearer '+item.token;
    let r;
    try{
      r=await fetchImpl(url+item.path,{
        method:item.method,headers,body:item.body,
        signal:AbortSignal.timeout(8000),redirect:'error'
      });
    }catch{E('network or TLS error in '+item.name);}
    if(r.status!==item.status)E('unexpected status in '+item.name);
    const cache=r.headers.get('cache-control');
    if(!cache||!/(?:^|,)\s*no-store\b/i.test(cache))
      E('cache policy missing for '+item.name);
    if(r.headers.get('access-control-allow-origin')==='*')
      E('wildcard CORS in '+item.name);
    const mime=r.headers.get('content-type')||'';
    if(!/^application\/json\b/i.test(mime))
      E('non-JSON error surface in '+item.name);
    results.push(Object.freeze({check:item.name,result:'PASS'}));
  }
  return Object.freeze({service:'M2 Staging Cloud Run',scope:'unauthenticated read-only',
    count:results.length,results});
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.env.HEREMATE_M2_SMOKE_APPROVED!=='true'||
     process.env.HEREMATE_M2_PROJECT!=='heremate'){
    process.stderr.write('M2_STAGING_SMOKE_BLOCKED: explicit staging approval missing\n');
    process.exitCode=1;
  }else{
    runM2ReadOnlySmoke({origin:process.argv[2],consent:true})
      .then(result=>console.log(JSON.stringify(result,null,2)))
      .catch(()=>{process.stderr.write('M2_STAGING_SMOKE_BLOCKED: validation failed\n');process.exitCode=1;});
  }
}
