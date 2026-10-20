import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkEasConfig,checkReviewedMerge,verifyBuild} from '../scripts/verify-release.mjs';

const app=JSON.parse(readFileSync(new URL('../app.json',import.meta.url)));
const eas=JSON.parse(readFileSync(new URL('../eas.json',import.meta.url)));
const id='923e4567-e89b-42d3-a456-426614174000',sha='a'.repeat(40),source='b'.repeat(40);
const linked=structuredClone(app);linked.expo.extra.eas={projectId:id};
const api={
 '/git/ref/heads/main':{object:{sha}},
 ['/commits/'+sha+'/pulls']:[{number:7,merged_at:'2026-10-20T10:00:00Z',merge_commit_sha:sha,base:{ref:'main',repo:{full_name:'chaithawat03/HereMate'}},head:{sha:source,repo:{full_name:'chaithawat03/HereMate'}}}],
 ['/commits/'+source+'/check-runs?per_page=100']:{check_runs:[{name:'foundation',conclusion:'success'},{name:'mobile',conclusion:'success'}]},
 '/pulls/7/reviews?per_page=100':[{state:'COMMENTED'}]
};
const apiMock=(db)=>async(uri)=>{const url=new URL(uri);const path=url.pathname.split('/repos/chaithawat03/HereMate')[1]+url.search;return {ok:Object.hasOwn(db,path),status:Object.hasOwn(db,path)?200:404,json:async()=>db[path]}};
const check=(db=api)=>checkReviewedMerge({sha,ref:'refs/heads/main',repo:'chaithawat03/HereMate',token:'unit-test-fake',fetcher:apiMock(db)});

test('Expo project ID must be existing pinned UUID',()=>{
 assert.equal(checkEasConfig(linked,eas,id).slug,'heremate');
 assert.throws(()=>checkEasConfig(app,eas,id),/UUID/);
 assert.throws(()=>checkEasConfig(linked,eas,'invalid'),/UUID/);
});
test('Production profile or unrelated Expo account is rejected',()=>{
 const e=structuredClone(eas);e.build.production={};assert.throws(()=>checkEasConfig(linked,e,id),/staging/);
 const a=structuredClone(linked);a.expo.owner='wrong';assert.throws(()=>checkEasConfig(a,eas,id),/owner/);
});
test('Reviewed PR merge and both checks must pass',async()=>{
 assert.equal((await check()).pr,7);
 const changed=structuredClone(api);changed['/git/ref/heads/main'].object.sha='c'.repeat(40);await assert.rejects(check(changed),/main moved/);
 const noPR=structuredClone(api);noPR['/commits/'+sha+'/pulls']=[];await assert.rejects(check(noPR),/merged PR/);
 const failed=structuredClone(api);failed['/commits/'+source+'/check-runs?per_page=100'].check_runs=[];await assert.rejects(check(failed),/not green/);
 const noReview=structuredClone(api);noReview['/pulls/7/reviews?per_page=100']=[];await assert.rejects(check(noReview),/review/);
});
test('Only Android completed APK EAS result accepted',()=>{
 const good={id,platform:'ANDROID',status:'FINISHED',buildProfile:'android-preview',gitCommitHash:sha,artifacts:{applicationArchiveUrl:'https://example.org/file.apk'}};
 assert.equal(verifyBuild(good,sha).buildId,id);
 assert.throws(()=>verifyBuild({...good,status:'IN_PROGRESS'},sha),/not finished/);
 assert.throws(()=>verifyBuild({...good,platform:'IOS'},sha),/not finished/);
 assert.throws(()=>verifyBuild({...good,artifacts:{}},sha),/URL/);
 assert.throws(()=>verifyBuild({...good,gitCommitHash:'c'.repeat(40)},sha),/mismatch/);
});
test('EAS workflow has opt-in and staging safety gates',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/staging-eas-build.yml',import.meta.url),'utf8');
 assert.match(workflow,/STAGING_EAS_ENABLED/);
 assert.match(workflow,/verify-merge/);
 assert.match(workflow,/validate-config/);
 assert.match(workflow,/environment: staging-eas/);
 assert.match(workflow,/--platform android --profile android-preview/);
 assert.match(workflow,/--wait --json/);
 assert.doesNotMatch(workflow,/GOOGLE_DRIVE_REFRESH_TOKEN|id-token:\s*write/);
});
