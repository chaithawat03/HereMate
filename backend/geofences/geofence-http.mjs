/**
 * M4 Staging HTTP boundary: a dormant, optional Cloud Run router.
 * Implements exact POST routes, strict JSON, Firebase ID bearer, no query/CORS,
 * 2KiB max request bodies, no authentication/location logging and no GPS
 * coordinates in response except proposed circle in SUBJECT-ONLY review.
 * NOT connected to the currently deployed M2 Cloud Run listener.
 */
import {
 GeofenceDenied,GeofenceInvalid,GeofenceBusy,GeofenceLimited
} from './geofence-service.mjs';

const HEADERS=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store, private, max-age=0',
 'Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff',
 'Content-Security-Policy':"default-src 'none'"
});
const response=(status,body)=>({status,headers:HEADERS,body});
export const MAX_GEOFENCE_REQUEST_BYTES=2048;
export const GEOFENCE_ROUTES=Object.freeze({
 '/v1/geofences/propose':{method:'propose',keys:['subjectUid','circle']},
 '/v1/geofences/review':{method:'review',keys:['ownerUid']},
 '/v1/geofences/decide':{method:'decide',keys:[
   'ownerUid','approve','proposalCreatedAtMs'
 ]},
 '/v1/geofences/revoke':{method:'revoke',keys:['ownerUid','subjectUid']},
 '/v1/geofences/evaluate':{method:'evaluate',keys:[
   'ownerUid','point','appInForeground','foregroundPermissionGranted'
 ]}
});
const exact=(obj,keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 Object.keys(obj).length===keys.length&&
 Object.keys(obj).every(key=>keys.includes(key));
export async function handleGeofenceHttp({
  method,path,contentType,authorization,bodyText
},service){
 const route=GEOFENCE_ROUTES[path];
 if(!route)return response(404,{error:'not_found'});
 if(method!=='POST')return response(405,{error:'method_not_allowed'});
 if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType||''))
   return response(415,{error:'unsupported_media_type'});
 if(typeof bodyText!=='string'||
    Buffer.byteLength(bodyText,'utf8')>MAX_GEOFENCE_REQUEST_BYTES)
   return response(413,{error:'payload_too_large'});
 const token=/^Bearer ([A-Za-z0-9._-]{32,8192})$/.exec(authorization||'')?.[1];
 if(!token)return response(401,{error:'unauthorized'});
 let body;
 try{body=JSON.parse(bodyText);}catch{return response(400,{error:'invalid_request'});}
 if(!exact(body,route.keys))return response(400,{error:'invalid_request'});
 try{
   const result=await service[route.method]({idToken:token,...body});
   return response(200,result);
 }catch(error){
   if(error instanceof GeofenceDenied)return response(404,{error:'not_available'});
   if(error instanceof GeofenceInvalid)return response(400,{error:'invalid_request'});
   if(error instanceof GeofenceLimited)return response(429,{error:'too_many_requests'});
   if(error instanceof GeofenceBusy)return response(503,{error:'temporarily_unavailable'});
   // Never reveal Firebase uid, zone coordinates or raw credential in errors.
   return response(503,{error:'temporarily_unavailable'});
 }
}
