/**
 * M2.4 HTTP edge for a future Android Staging-only Cloud Run service.
 * No deployment/configuration or runtime listener occurs by importing this file.
 * Never log incoming credentials, bodies or coordinates.
 */
import {handleLocationHttp} from '../location/http.mjs';

const MAX_BYTES=1024;
const SECURITY_HEADERS=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, private, max-age=0',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'none'",
});
function reply(res,status,body,headers=SECURITY_HEADERS) {
  if(res.headersSent || res.writableEnded)return;
  res.writeHead(status,headers);
  res.end(JSON.stringify(body));
}
export function createNodeLocationHandler(service) {
  if(!service || !['start','stop','publish','read'].every(k=>typeof service[k]==='function'))
    throw Error('location_service_unavailable');
  return async (req,res)=>{
    try {
      // Node may collapse duplicate Authorization headers before req.headers.
      // Fail closed on ambiguous credentials and forged request framing.
      const raw=req.rawHeaders||[];
      const count=name=>raw.filter((v,i)=>i%2===0&&
        typeof v==='string'&&v.toLowerCase()===name).length;
      if(count('authorization')!==1||count('content-length')>1||
         (count('transfer-encoding')&&count('content-length'))){
        reply(res,401,{error:'unauthorized'});
        return;
      }
      const claimedLength=req.headers['content-length'];
      if(claimedLength!==undefined &&
        (!/^[0-9]+$/.test(String(claimedLength))||Number(claimedLength)>MAX_BYTES)){
        reply(res,413,{error:'payload_too_large'});
        return;
      }
      let size=0,bodyText='';
      for await(const chunk of req) {
        size+=Buffer.byteLength(chunk);
        if(size>MAX_BYTES){
          reply(res,413,{error:'payload_too_large'});
          return;
        }
        bodyText+=Buffer.from(chunk).toString('utf8');
      }
      // Do not silently ignore query parameters or multiple Authorization values.
      const path=typeof req.url==='string'&&!req.url.includes('?')?req.url:'/invalid';
      const auth=req.headers.authorization;
      const result=await handleLocationHttp({
        method:req.method,path,
        contentType:typeof req.headers['content-type']==='string'?req.headers['content-type']:'',
        authorization:typeof auth==='string'?auth:'',
        bodyText
      },service);
      reply(res,result.status,result.body,result.headers);
    }catch{
      // No stack traces, tokens, coordinates or error details in HTTP responses.
      reply(res,503,{error:'temporarily_unavailable'});
    }
  };
}
