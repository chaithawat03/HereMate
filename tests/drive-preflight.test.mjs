import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preflightPrivateDrive } from '../scripts/preflight-private-drive.mjs';

const folderId='1Q0zgRbKdt9l6ZeEU4KILSf_1vUjQ2gmo';
const email='owner@example.org';
const credentials={client_id:'fixture-client',client_secret:'fixture-secret',refresh_token:'fixture-refresh'};
const folder={id:folderId,name:'HereMate',mimeType:'application/vnd.google-apps.folder',shared:false,
 capabilities:{canAddChildren:true},owners:[{emailAddress:email}],permissions:[{type:'user',role:'owner'}]};
const getMock=(folderOverride={},tokenScope='https://www.googleapis.com/auth/drive.file')=>{
 let calls=[];
 const mock=async(url,opts)=>{
   const uri=String(url);calls.push({uri,method:opts.method||'GET'});
   if(uri==='https://oauth2.googleapis.com/token')
     return {ok:true,json:async()=>({access_token:'test-access-token',token_type:'Bearer',scope:tokenScope})};
   if(uri.includes('/about?'))
     return {ok:true,json:async()=>({user:{emailAddress:email}})};
   if(uri.includes('/files/'+folderId+'?'))
     return {ok:true,json:async()=>({...folder,...folderOverride})};
   throw Error('unexpected network request');
 };
 return {mock,calls};
};

test('read-only preflight verifies OAuth token scope, owner and existing Restricted folder',async()=>{
 const {mock,calls}=getMock();
 const r=await preflightPrivateDrive({credentials,folderId,expectedEmail:email,fetcher:mock});
 assert.equal(r.restricted,true);
 assert.equal(r.writable,true);
 assert.deepEqual(calls.map(x=>x.method),['POST','GET','GET']);
 assert.ok(calls.every(x=>!x.uri.includes('/upload/')));
});
test('wrong owner, public folder, or no write access is blocked',async()=>{
 for(const bad of [{shared:true},{capabilities:{canAddChildren:false}},{owners:[]}]) {
   const {mock}=getMock(bad);
   await assert.rejects(preflightPrivateDrive({credentials,folderId,expectedEmail:email,fetcher:mock}),/folder/);
 }
});
test('wrong token scope, missing folder config, and refresh failure are blocked',async()=>{
 const scope=getMock({},'https://www.googleapis.com/auth/drive');
 await assert.rejects(preflightPrivateDrive({credentials,folderId,expectedEmail:email,fetcher:scope.mock}),/only drive.file/);
 await assert.rejects(preflightPrivateDrive({credentials,folderId:'wrong',expectedEmail:email}),/destination/);
 const noToken=async(uri)=>({ok:false,status:400});
 await assert.rejects(preflightPrivateDrive({credentials,folderId,expectedEmail:email,fetcher:noToken}),/refresh failed/);
});

test('workflow_dispatch preflight cannot enter EAS build or Drive publishing',()=>{
 const w=readFileSync(new URL('../.github/workflows/staging-eas-build.yml',import.meta.url),'utf8');
 assert.match(w,/run_mode:\s*\n\s*description:[^\n]+\n\s*required: true\n\s*type: choice/);
 assert.match(w,/default: preflight/);
 const preflight=w.split('  preflight-private-drive:')[1]?.split('  verify-reviewed-merge:')[0];
 const verify=w.split('  verify-reviewed-merge:')[1]?.split('  build-android-staging:')[0];
 const build=w.split('  build-android-staging:')[1]?.split('  publish-android-to-private-drive:')[0];
 assert.ok(preflight && verify && build);
 assert.match(preflight,/environment: staging-drive/);
 assert.match(preflight,/id-token: write/);
 assert.match(preflight,/inputs.run_mode == 'preflight'/);
 assert.match(preflight,/scripts\/preflight-private-drive.mjs/);
 assert.doesNotMatch(preflight,/eas build|download-artifact|upload-artifact|upload[ -]APK|node scripts\/publish-staging-drive.mjs/);
 assert.match(verify,/inputs.run_mode == 'build'/);
 assert.match(build,/inputs.run_mode == 'build'/);
 assert.doesNotMatch(verify,/id-token: write/);
 assert.doesNotMatch(build,/id-token: write/);
});
