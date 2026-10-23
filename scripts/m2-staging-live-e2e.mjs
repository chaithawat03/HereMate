/**
 * HereMate M2 Staging LIVE synthetic two-account E2E.
 * Opt-in manual Cloud Shell only; NEVER CI, Production or actual phone GPS.
 * Uses temporary Firebase Anonymous users, synthetic (0,0), Firestore REST,
 * existing Cloud Run HTTPS and finally removes the test relation/accounts.
 * No service-account keys, refresh-token persistence or token/UID logging.
 */
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const PROJECT='heremate';
export const STAGING_ORIGINS=Object.freeze([
  'https://heremate-m2-location-staging-976775896533.asia-southeast1.run.app',
  'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app'
]);
const FIREBASE_PUBLIC_WEB_API_KEY='AIzaSyAIA-R2iVAFCA7MvR84eZRgvt1b-HnmJBw';
const UID=/^[A-Za-z0-9_-]{12,128}$/;
const API='https://identitytoolkit.googleapis.com/v1';
const DB='https://firestore.googleapis.com/v1/projects/heremate/databases/(default)/documents';
const ENDPOINTS=Object.freeze({
  start:'/v1/locations/grants/start',
  stop:'/v1/locations/grants/stop',
  publish:'/v1/locations/points/publish',
  read:'/v1/locations/points/read'
});
const refuse=reason=>{throw Error('M2_LIVE_STAGING_BLOCKED: '+reason);};

export function assertStagingOrigin(input){
  if(!STAGING_ORIGINS.includes(input))refuse('unknown staging origin');
  const url=new URL(input);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||
     url.search||url.hash)refuse('invalid HTTPS origin');
  return url.origin;
}
export function syntheticFix(now=Date.now()){
  if(!Number.isSafeInteger(now)||now<=0)refuse('invalid test clock');
  return {latitude:0,longitude:0,accuracyMeters:10,capturedAtMs:now-500};
}
async function http(url,{method='POST',headers={},body}={}){
  let response;
  try{
    response=await fetch(url,{
      method,headers:{'Content-Type':'application/json',...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(15000),
      redirect:'error'
    });
  }catch{refuse('HTTPS transport failure');}
  const data=await response.json().catch(()=>null);
  return {status:response.status,data};
}
function expected(result,status,label){
  if(result.status!==status)
    refuse(label+' HTTP '+result.status+' (expected '+status+')');
  process.stdout.write('PASS '+label+' ('+status+')\n');
  return result.data;
}
function webEndpoint(action){
  return API+'/accounts:'+action+'?key='+FIREBASE_PUBLIC_WEB_API_KEY;
}
async function newAnonymousUser(){
  const res=await http(webEndpoint('signUp'),{body:{returnSecureToken:true}});
  if(res.status!==200||!UID.test(res.data?.localId||'')||
     typeof res.data?.idToken!=='string'||res.data.idToken.length<100)
    refuse('Firebase Anonymous Auth unavailable HTTP '+res.status);
  return {uid:res.data.localId,token:res.data.idToken};
}
function firestoreFields(values){
  const fields={};
  for(const [key,value] of Object.entries(values)){
    if(typeof value==='boolean')fields[key]={booleanValue:value};
    else if(typeof value==='string')fields[key]={stringValue:value};
    else if(Number.isSafeInteger(value))fields[key]={integerValue:String(value)};
    else refuse('invalid test Firestore field');
  }
  return {fields};
}
function timestampField(date){return {timestampValue:new Date(date).toISOString()};}
async function cloudCall(origin,user,route,body){
  return http(origin+ENDPOINTS[route],{
    headers:user?{Authorization:'Bearer '+user.token}:{},
    body
  });
}
function oauthToken(){
  const project=execFileSync('gcloud',['config','get-value','project'],
    {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  if(project!==PROJECT)refuse('wrong active GCP project');
  const token=execFileSync('gcloud',['auth','print-access-token'],
    {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  if(!token||!token.startsWith('ya29.'))refuse('gcloud OAuth token unavailable');
  return token;
}
async function firestoreWrite(url,oauth,body,method){
  return http(url,{
    method,
    headers:{Authorization:'Bearer '+oauth},
    body
  });
}
async function bestEffortCleanup({origin,owner,viewer,stranger,docUrl,oauth}){
  if(owner&&viewer){
    try{await cloudCall(origin,owner,'stop',{viewerUid:viewer.uid});}
    catch{process.stderr.write('CLEANUP_NOTE: STOP failed; private grants have 60s expiry\n');}
  }
  if(docUrl&&oauth){
    try{
      const r=await firestoreWrite(docUrl,oauth,undefined,'DELETE');
      if(r.status!==200)process.stderr.write('CLEANUP_NOTE: test friendship cleanup HTTP '+r.status+'\n');
    }catch{process.stderr.write('CLEANUP_NOTE: test friendship cleanup failed\n');}
  }
  for(const user of [stranger,viewer,owner]){
    if(!user)continue;
    try{
      const r=await http(webEndpoint('delete'),{body:{idToken:user.token}});
      if(r.status!==200)process.stderr.write('CLEANUP_NOTE: anonymous account cleanup HTTP '+r.status+'\n');
    }catch{process.stderr.write('CLEANUP_NOTE: anonymous account cleanup failed\n');}
  }
}

export async function runLiveStaging({origin,confirmed}){
  const verified=assertStagingOrigin(origin);
  if(confirmed!==true)refuse('explicit isolated test confirmation missing');
  if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST||
     process.env.GOOGLE_APPLICATION_CREDENTIALS)
    refuse('emulator host or key-file environment not allowed');
  const oauth=oauthToken();
  let owner,viewer,stranger,docUrl=null;
  const state=()=>({origin:verified,owner,viewer,stranger,docUrl,oauth});
  try{
    expected(await cloudCall(verified,null,'read',
      {ownerUid:'no_real_account_000001'}),401,'no token rejected');
    owner=await newAnonymousUser();
    viewer=await newAnonymousUser();
    stranger=await newAnonymousUser();
    process.stdout.write('PASS created 3 isolated anonymous test accounts (no UIDs logged)\n');
    const docId=owner.uid+'__'+viewer.uid;
    docUrl=DB+'/friendRequests/'+encodeURIComponent(docId);
    const now=Date.now();
    const first=firestoreFields({
      schemaVersion:1,senderUid:owner.uid,recipientUid:viewer.uid,
      senderDisplayName:'M2 Test Sender',recipientDisplayName:'M2 Test Viewer',
      status:'accepted',senderConsent:true,recipientConsent:false
    });
    first.fields.createdAt=timestampField(now);
    first.fields.updatedAt=timestampField(now);
    expected(await firestoreWrite(docUrl+'?currentDocument.exists=false',oauth,
      first,'PATCH'),200,'created isolated friendship');
    expected(await cloudCall(verified,owner,'start',
      {viewerUid:viewer.uid}),404,'one-sided consent blocks START');
    expected(await cloudCall(verified,viewer,'read',
      {ownerUid:owner.uid}),404,'one-sided consent blocks READ');
    expected(await cloudCall(verified,stranger,'read',
      {ownerUid:owner.uid}),404,'stranger cannot READ');
    const both={fields:{
      recipientConsent:{booleanValue:true},
      updatedAt:timestampField(now+1000)
    }};
    expected(await firestoreWrite(docUrl+
      '?updateMask.fieldPaths=recipientConsent&updateMask.fieldPaths=updatedAt',
      oauth,both,'PATCH'),200,'enabled two-party consent');
    const started=expected(await cloudCall(verified,owner,'start',
      {viewerUid:viewer.uid}),200,'consented START');
    if(started?.enabled!==true)refuse('START response not enabled');
    const written=expected(await cloudCall(verified,owner,'publish',{
      viewerUid:viewer.uid,point:syntheticFix(),
      appInForeground:true,foregroundPermissionGranted:true
    }),200,'synthetic (0,0) PUBLISH');
    if(written?.stored!==true)refuse('PUBLISH acknowledgement missing');
    const read=expected(await cloudCall(verified,viewer,'read',
      {ownerUid:owner.uid}),200,'authorized viewer READ');
    if(read?.point?.latitude!==0||read?.point?.longitude!==0)
      refuse('expected only synthetic (0,0) fix');
    expected(await cloudCall(verified,stranger,'read',
      {ownerUid:owner.uid}),404,'stranger denied after publication');
    expected(await firestoreWrite(docUrl+
      '?updateMask.fieldPaths=recipientConsent&updateMask.fieldPaths=updatedAt',
      oauth,{fields:{
        recipientConsent:{booleanValue:false},
        updatedAt:timestampField(now+2000)
      }},'PATCH'),200,'revoked viewer consent');
    expected(await cloudCall(verified,viewer,'read',
      {ownerUid:owner.uid}),404,'consent revocation blocks READ');
    expected(await cloudCall(verified,owner,'stop',
      {viewerUid:viewer.uid}),200,'owner STOP');
    expected(await cloudCall(verified,viewer,'read',
      {ownerUid:owner.uid}),404,'STOP blocks READ');
    process.stdout.write('M2 LIVE STAGING E2E: PASS (synthetic data; not mobile GPS)\n');
    return true;
  }finally{
    await bestEffortCleanup(state());
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  runLiveStaging({
    origin:process.argv[2],
    confirmed:process.argv[3]==='--confirm=heremate-m2-staging'
  }).catch(error=>{
    process.stderr.write(String(error?.message||'M2 live test failed')+'\n');
    process.exitCode=1;
  });
}