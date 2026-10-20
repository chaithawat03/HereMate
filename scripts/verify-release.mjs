import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoId='chaithawat03/HereMate';
const block=(reason)=>{throw Error('STAGING RELEASE BLOCKED: '+reason)};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function checkEasConfig(app,eas,projectId){
  const exp=app?.expo, p=eas?.build?.['android-preview'];
  if(exp?.owner!=='smartyyys-team'||exp?.slug!=='heremate')block('wrong Expo owner/slug');
  if(exp?.extra?.environment!=='staging'||exp?.android?.package!=='com.chaithawat03.heremate')block('wrong staging application');
  if(eas?.build?.production!==undefined||p?.distribution!=='internal'||p.android?.buildType!=='apk'||p.env?.EXPO_PUBLIC_ENVIRONMENT!=='staging')block('not an Android staging APK profile');
  if(!eas?.build?.['ios-simulator']?.ios?.simulator)block('iOS simulator profile missing');
  if(!uuid.test(projectId||'')||exp?.extra?.eas?.projectId!==projectId)block('existing Expo project UUID not yet verified in app.json');
  return {owner:exp.owner,slug:exp.slug,projectId};
}
export async function checkReviewedMerge({sha,ref,repo,token,fetcher=fetch}){
  if(repo!==repoId||ref!=='refs/heads/main'||!/^[a-f0-9]{40}$/.test(sha||'')||!token)block('invalid repository, ref or SHA');
  const get=async(path)=>{
    const r=await fetcher('https://api.github.com/repos/'+repo+path,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
    if(!r.ok)block('GitHub API '+r.status+' at '+path);
    return r.json();
  };
  const current=await get('/git/ref/heads/main');
  if(current?.object?.sha!==sha)block('main moved since workflow started');
  const prs=await get('/commits/'+sha+'/pulls');
  const p=Array.isArray(prs)&&prs.find(x=>x?.merged_at&&x.merge_commit_sha===sha&&x.base?.ref==='main'&&x.base?.repo?.full_name===repo&&x.head?.repo?.full_name===repo&&/^[a-f0-9]{40}$/.test(x.head?.sha||''));
  if(!p)block('source SHA does not belong to reviewed merged PR');
  const [checks,reviews]=await Promise.all([
    get('/commits/'+p.head.sha+'/check-runs?per_page=100'),get('/pulls/'+p.number+'/reviews?per_page=100')
  ]);
  const green=new Set((checks?.check_runs||[]).filter(x=>x.conclusion==='success').map(x=>x.name));
  if(!['foundation','mobile'].every(x=>green.has(x)))block('required PR checks not green');
  if(!Array.isArray(reviews)||!reviews.some(x=>x.state==='APPROVED'||x.state==='COMMENTED'))block('no GitHub review evidence');
  return {mergedSha:sha,pr:p.number,sourceSha:p.head.sha,requiredChecks:['foundation','mobile']};
}
export function verifyBuild(output,sha){
  const build=Array.isArray(output)?(output.length===1?output[0]:null):output;
  if(!uuid.test(build?.id||'')||String(build.status).toLowerCase()!=='finished'||String(build.platform).toLowerCase()!=='android')block('Android EAS build not finished');
  if(build.buildProfile!=='android-preview')block('unexpected EAS build profile');
  if(build.gitCommitHash&&build.gitCommitHash!==sha)block('source commit mismatch');
  const url=build.artifacts?.applicationArchiveUrl||build.artifacts?.buildUrl;
  if(typeof url!=='string'||!/^https:\/\//.test(url))block('missing APK artifact URL');
  return {buildId:build.id,platform:'android',profile:build.buildProfile,sha,status:'finished',artifactUrl:url,verifiedAt:new Date().toISOString()};
}
async function main(){
  switch(process.argv[2]){
    case 'validate-config':{
      const config=checkEasConfig(JSON.parse(readFileSync('app.json')),JSON.parse(readFileSync('eas.json')),process.env.STAGING_EAS_PROJECT_ID);
      console.log('Verified existing Expo Project:',config.owner+'/'+config.slug,config.projectId);break;
    }
    case 'verify-merge':{
      const info=await checkReviewedMerge({sha:process.env.GITHUB_SHA,ref:process.env.GITHUB_REF,repo:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN});
      console.log('Verified reviewed merge:',JSON.stringify(info));break;
    }
    case 'verify-build':{
      const manifest=verifyBuild(JSON.parse(readFileSync(process.argv[3])),process.env.GITHUB_SHA);
      writeFileSync(process.argv[4],JSON.stringify(manifest,null,2)+'\n');
      console.log('Verified EAS build:',manifest.buildId);break;
    }
    default:block('unknown command');
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1});
