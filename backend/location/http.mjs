/**
 * M2.1 JSON HTTP boundary (NO server listener or deployment).
 * A production Cloud Run entrypoint must enforce TLS, request timeouts, CORS,
 * trusted edge source/rate limits, and request body byte caps BEFORE invocation.
 */
import {LocationDenied,LocationInvalid,LocationLimited} from './location-service.mjs';

const HEADERS=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, private, max-age=0',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'",
});
const response=(status,body)=>({status,headers:HEADERS,body});
const shape=(body,keys)=>body&&typeof body==='object'&&!Array.isArray(body)&&
  Object.keys(body).length===keys.length&&Object.keys(body).every(k=>keys.includes(k));
const endpoints=Object.freeze({
  '/v1/locations/grants/start':{method:'start',keys:['viewerUid']},
  '/v1/locations/grants/stop':{method:'stop',keys:['viewerUid']},
  '/v1/locations/points/publish':{method:'publish',keys:['viewerUid','point','appInForeground','foregroundPermissionGranted']},
  '/v1/locations/points/read':{method:'read',keys:['ownerUid']},
  '/v2/locations/sessions/start':{method:'startDevice',keys:['viewerUid']},
  '/v2/locations/sessions/publish':{method:'publishDevice',keys:[
    'viewerUid','sessionToken','point','appInForeground','foregroundPermissionGranted'
  ]},
  '/v2/locations/sessions/stop':{method:'stopDevice',keys:['viewerUid','sessionToken']},
});

export async function handleLocationHttp({method,path,contentType,authorization,bodyText},service) {
  const route=endpoints[path];
  if(!route)return response(404,{error:'not_found'});
  if(method!=='POST')return response(405,{error:'method_not_allowed'});
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType||''))
    return response(415,{error:'unsupported_media_type'});
  if(typeof bodyText!=='string'||Buffer.byteLength(bodyText,'utf8')>1024)
    return response(413,{error:'payload_too_large'});
  const token=/^Bearer ([A-Za-z0-9._-]{32,8192})$/.exec(authorization||'')?.[1];
  if(!token)return response(401,{error:'unauthorized'});
  let body;
  try {body=JSON.parse(bodyText);}
  catch{return response(400,{error:'invalid_request'});}
  if(!shape(body,route.keys))return response(400,{error:'invalid_request'});
  try{
    const data=await service[route.method]({idToken:token,...body});
    return response(200,data);
  }catch(error){
    if(error instanceof LocationDenied)return response(404,{error:'not_available'});
    if(error instanceof LocationInvalid)return response(400,{error:'invalid_request'});
    if(error instanceof LocationLimited)return response(429,{error:'too_many_requests'});
    // No stack, raw UID, coordinates, Firebase errors or auth token in response.
    return response(503,{error:'temporarily_unavailable'});
  }
}
