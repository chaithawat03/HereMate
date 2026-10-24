/**
 * M3 v2 Staging route-discovery smoke (GET-only, no authentication, no GPS).
 * Does not deploy or mutate Cloud Run, Firestore, IAM, or location sessions.
 * Operator approval is required before making any external HTTPS request.
 * This is route availability evidence, NOT authorization/device acceptance.
 */
import {fileURLToPath} from 'node:url';

const APPROVED_ORIGINS=Object.freeze([
  'https://heremate-m2-location-staging-976775896533.asia-southeast1.run.app',
  'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app'
]);
const ROUTES=Object.freeze([
  '/v1/locations/points/read',
  '/v2/locations/sessions/start',
  '/v2/locations/sessions/publish',
  '/v2/locations/sessions/stop'
]);
const NEGATIVE_CONTROL='/v2/locations/sessions/__not_a_route__';
const fail=reason=>{throw Error('M3_V2_ROUTE_SMOKE_BLOCKED: '+reason);};

export function validateM3V2StagingOrigin(input){
  if(typeof input!=='string')fail('missing origin');
  let url;
  try{url=new URL(input);}catch{fail('invalid origin');}
  if(!APPROVED_ORIGINS.includes(url.origin)||url.protocol!=='https:'||
     url.username||url.password||url.port||url.pathname!=='/'||
     url.search||url.hash||
     (input!==url.origin&&input!==url.origin+'/'))
    fail('origin is not the exact approved Staging endpoint');
  return url.origin;
}

export async function runM3V2StagingRouteSmoke({origin,approved=false,fetchImpl=fetch}){
  if(approved!==true)fail('explicit operator approval required');
  const base=validateM3V2StagingOrigin(origin);
  if(typeof fetchImpl!=='function')fail('invalid HTTPS client');
  const results=[];
  // A generic gateway 405 for *every* path is not evidence of v2 routes.
  const probes=[...ROUTES.map(path=>({path,expected:405})),
    {path:NEGATIVE_CONTROL,expected:404}];
  for(const {path,expected} of probes){
    let response;
    try{
      response=await fetchImpl(base+path,{
        method:'GET',
        redirect:'error',
        headers:{Accept:'application/json','Cache-Control':'no-store'},
        signal:AbortSignal.timeout(8000)
      });
    }catch{fail('TLS/network/redirect failure at '+path);}
    // Recognized POST-only route must reject GET with 405. An absent v2
    // route returns 404, which must NOT be mistaken for successful rollout.
    if(response?.status!==expected)fail('route presence/absence not verified at '+path);
    const cache=response.headers?.get('cache-control')||'';
    const mime=response.headers?.get('content-type')||'';
    if(!/(?:^|,)\s*no-store\b/i.test(cache))fail('missing no-store at '+path);
    if(!/^application\/json\b/i.test(mime))fail('non-JSON response at '+path);
    if(response.headers.get('access-control-allow-origin')==='*')
      fail('wildcard CORS at '+path);
    results.push(Object.freeze({route:path,status:expected,result:'PASS'}));
  }
  return Object.freeze({scope:'M3 v2 Staging route presence only — GET, no bearer or GPS',
    origin:base,verifiedRoutes:ROUTES.length,negativeControls:1,results});
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.env.HEREMATE_M3_V2_READONLY_APPROVED!=='true'||
     process.env.HEREMATE_M3_PROJECT!=='heremate'){
    process.stderr.write('M3_V2_ROUTE_SMOKE_BLOCKED: explicit Staging approval missing\n');
    process.exitCode=1;
  }else{
    runM3V2StagingRouteSmoke({origin:process.argv[2],approved:true})
      .then(value=>console.log(JSON.stringify(value,null,2)))
      .catch(()=>{
        process.stderr.write('M3_V2_ROUTE_SMOKE_BLOCKED: validation failed\n');
        process.exitCode=1;
      });
  }
}
