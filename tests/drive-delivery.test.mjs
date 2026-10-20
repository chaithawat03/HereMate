import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DRIVE_FOLDER_ID, EAS_PROJECT_ID, DRIVE_SCOPE,
  validateBuildManifest, checkAccess, checkOAuthScope, validateOAuthCredentials,
  computeBufferHashes, assertStoredMetadata, refreshAccessToken
} from '../scripts/publish-staging-drive.mjs';

const sha='a'.repeat(40),build='0d993fc6-c204-4d5c-9dc2-156339a54719';
const valid={sha,buildId:build,platform:'android',profile:'android-preview',status:'finished',artifactUrl:'https://expo.dev/artifacts/eas/demo.apk'};
const owner='test@example.org';
const folder={
  id:DRIVE_FOLDER_ID,name:'HereMate',mimeType:'application/vnd.google-apps.folder',
  shared:false,capabilities:{canAddChildren:true},owners:[{emailAddress:owner}],
  permissions:[{type:'user',role:'owner'}]
};
const check=(overrides={})=>checkAccess({about:{user:{emailAddress:owner}},
  folder:{...folder,...overrides},expectedEmail:owner,folderId:DRIVE_FOLDER_ID});

test('staging EAS Build Manifest must be approved Android APK and source SHA',()=>{
  assert.equal(validateBuildManifest(valid,sha).buildId,build);
  assert.throws(()=>validateBuildManifest({...valid,sha:'b'.repeat(40)},sha),/source SHA/);
  assert.throws(()=>validateBuildManifest({...valid,profile:'production'},sha),/non-staging/);
  assert.throws(()=>validateBuildManifest({...valid,status:'in-progress'},sha),/unfinished/);
  assert.throws(()=>validateBuildManifest({...valid,artifactUrl:'http://evil.example/abc.apk'},sha),/unapproved/);
  assert.throws(()=>validateBuildManifest({...valid,artifactUrl:'https://expo.dev/metadata.json'},sha),/unapproved/);
});

test('Drive destination must be privately owned and writable with exact folder ID',()=>{
  check();
  assert.throws(()=>check({shared:true}),/folder/);
  assert.throws(()=>check({capabilities:{canAddChildren:false}}),/folder/);
  assert.throws(()=>check({owners:[]}),/folder/);
  assert.throws(()=>check({permissions:[{type:'anyone',role:'reader'}]}),/broad/);
  assert.throws(()=>checkAccess({about:{user:{emailAddress:'wrong@example.org'}},folder,expectedEmail:owner,folderId:DRIVE_FOLDER_ID}),/OAuth user/);
  assert.throws(()=>checkAccess({about:{user:{emailAddress:owner}},folder,expectedEmail:owner,folderId:'unapproved'}),/folder/);
});

test('OAuth scope permits only drive.file and credentials use minimal shape',()=>{
  checkOAuthScope(DRIVE_SCOPE);
  assert.throws(()=>checkOAuthScope('https://www.googleapis.com/auth/drive'),/only drive.file/);
  assert.throws(()=>checkOAuthScope(DRIVE_SCOPE+' https://www.googleapis.com/auth/drive'),/only drive.file/);
  const c={client_id:'test-client',client_secret:'test-secret',refresh_token:'test-refresh'};
  validateOAuthCredentials(c);
  assert.throws(()=>validateOAuthCredentials({...c,scopes:'drive'}),/unexpected/);
  assert.throws(()=>validateOAuthCredentials({client_id:'test'}),/incomplete/);
});

test('OAuth token refresh uses token endpoint with no broad scopes',async()=>{
  const c={client_id:'id',client_secret:'secret',refresh_token:'refresh'};
  let called=0;
  const fetcher=async(url,opts)=>{
    called++;
    assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.equal(opts.method,'POST');
    assert.equal(opts.body.get('grant_type'),'refresh_token');
    return {ok:true,json:async()=>({access_token:'access-only',token_type:'Bearer',scope:DRIVE_SCOPE})};
  };
  assert.equal(await refreshAccessToken(c,fetcher),'access-only');
  assert.equal(called,1);
  await assert.rejects(refreshAccessToken(c,async()=>({ok:true,json:async()=>({access_token:'x',token_type:'Bearer',scope:'https://www.googleapis.com/auth/drive'})})),/only drive.file/);
  await assert.rejects(refreshAccessToken(c,async()=>({ok:false,status:400})),/refresh failed/);
});

test('metadata verifier checks content size, Google MD5 and exact SHA-256 provenance tags',()=>{
  const data=Buffer.from('demo build manifest');
  const hashes=computeBufferHashes(data);
  const props={buildId:build,gitSha:sha,kind:'manifest'};
  const m={id:'google-file-id',name:'demo.json',size:String(hashes.size),md5Checksum:hashes.md5,
    parents:[DRIVE_FOLDER_ID],shared:false,appProperties:{...props,sha256:hashes.sha256}};
  assertStoredMetadata(m,DRIVE_FOLDER_ID,'demo.json',hashes,props);
  assert.throws(()=>assertStoredMetadata({...m,md5Checksum:'wrong'},DRIVE_FOLDER_ID,'demo.json',hashes,props),/mismatch/);
  assert.throws(()=>assertStoredMetadata({...m,parents:['different']},DRIVE_FOLDER_ID,'demo.json',hashes,props),/mismatch/);
  assert.throws(()=>assertStoredMetadata({...m,appProperties:{...m.appProperties,sha256:'b'.repeat(64)}},DRIVE_FOLDER_ID,'demo.json',hashes,props),/mismatch/);
});

test('delivery workflow is manual opt-in, WIF auth, no Production or public Drive',()=>{
  assert.equal(EAS_PROJECT_ID,'93bb1566-2f29-4898-bba3-30f93b8deb6e');
  const w=readFileSync(new URL('../.github/workflows/staging-eas-build.yml',import.meta.url),'utf8');
  assert.match(w,/STAGING_DRIVE_ENABLED/);
  assert.match(w,/environment: staging-drive/);
  assert.match(w,/id-token: write/);
  assert.match(w,/google-github-actions\/auth@v3/);
  assert.match(w,/gcloud secrets versions access/);
  assert.match(w,/scripts\/publish-staging-drive.mjs/);
  assert.doesNotMatch(w,/GOOGLE_DRIVE_REFRESH_TOKEN|drive\.readonly|drive\.metadata\.readonly/);
  assert.match(w,/^    environment: staging-eas/m);
  const ci=readFileSync(new URL('../.github/workflows/pr-ci.yml',import.meta.url),'utf8');
  assert.match(ci,/node --test tests\/drive-delivery\.test\.mjs/);
  assert.doesNotMatch(ci,/id-token:\s*write|secrets\.EXPO_TOKEN|secrets\.DRIVE_/);
});
