/**
 * Dormant Node HTTP edge for M4, intentionally NOT imported by deployed M2.
 * Identical fail-closed header framing rules to reviewed M2 Cloud Run edge.
 */
import {handleGeofenceHttp,MAX_GEOFENCE_REQUEST_BYTES} from './geofence-http.mjs';
const HEADERS=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store, private, max-age=0',
 'Pragma':'no-cache',
 'X-Content-Type-Options':'nosniff',
 'Content-Security-Policy':"default-src 'none'"
});
function reply(res,status,body,headers=HEADERS){
 if(res.headersSent||res.writableEnded)return;
 res.writeHead(status,headers);res.end(JSON.stringify(body));
}
export function createNodeGeofenceHandler(service){
 const methods=['propose','review','decide','revoke','evaluate'];
 if(!service||!methods.every(m=>typeof service[m]==='function'))
   throw Error('geofence_service_unavailable');
 return async (req,res)=>{
   try{
     const raw=req.rawHeaders||[];
     const count=name=>raw.filter((value,i)=>i%2===0&&
       typeof value==='string'&&value.toLowerCase()===name).length;
     if(count('authorization')!==1||count('content-length')>1||
        (count('transfer-encoding')&&count('content-length'))){
       reply(res,401,{error:'unauthorized'});return;
     }
     const length=req.headers['content-length'];
     if(length!==undefined&&(!/^[0-9]+$/.test(String(length))||
        Number(length)>MAX_GEOFENCE_REQUEST_BYTES)){
       reply(res,413,{error:'payload_too_large'});return;
     }
     let size=0,bodyText='';
     for await(const chunk of req){
       size+=Buffer.byteLength(chunk);
       if(size>MAX_GEOFENCE_REQUEST_BYTES){
         reply(res,413,{error:'payload_too_large'});return;
       }
       bodyText+=Buffer.from(chunk).toString('utf8');
     }
     const path=typeof req.url==='string'&&!req.url.includes('?')?req.url:'/invalid';
     const result=await handleGeofenceHttp({
       method:req.method,path,
       contentType:typeof req.headers['content-type']==='string'?req.headers['content-type']:'',
       authorization:typeof req.headers.authorization==='string'?req.headers.authorization:'',
       bodyText
     },service);
     reply(res,result.status,result.body,result.headers);
   }catch{reply(res,503,{error:'temporarily_unavailable'});}
 };
}
