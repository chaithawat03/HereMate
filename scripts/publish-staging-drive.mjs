import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, open, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const DRIVE_FOLDER_ID = '1Q0zgRbKdt9l6ZeEU4KILSf_1vUjQ2gmo';
export const EAS_PROJECT_ID = '93bb1566-2f29-4898-bba3-30f93b8deb6e';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[a-f0-9]{40}$/i;
const MAX_APK = 450 * 1024 * 1024;
const fail = reason => { throw new Error('M0.4 PRIVATE DRIVE DELIVERY BLOCKED: ' + reason); };

export function validateBuildManifest(data, sha) {
  if (!SHA.test(sha || '') || data?.sha !== sha || !UUID.test(data?.buildId || '')) fail('unexpected source SHA or EAS build ID');
  if (data?.platform !== 'android' || data?.profile !== 'android-preview' || data?.status !== 'finished') fail('non-staging or unfinished EAS artifact');
  const url = new URL(data.artifactUrl || 'https://invalid.example');
  if (url.protocol !== 'https:' || !['expo.dev', 'storage.googleapis.com'].includes(url.hostname) || !url.pathname.endsWith('.apk')) fail('unapproved APK origin or extension');
  return { ...data, artifactUrl: url.href };
}

export function checkAccess({ about, folder, expectedEmail, folderId }) {
  const who = about?.user?.emailAddress?.toLowerCase();
  if (!expectedEmail || who !== expectedEmail.toLowerCase()) fail('OAuth user differs from expected Drive owner');
  if (folderId !== DRIVE_FOLDER_ID || folder?.id !== folderId || folder?.name !== 'HereMate' ||
      folder?.mimeType !== 'application/vnd.google-apps.folder' || folder?.shared !== false ||
      folder?.capabilities?.canAddChildren !== true ||
      !Array.isArray(folder?.owners) || !folder.owners.some(o => o.emailAddress?.toLowerCase() === who)) {
    fail('existing Restricted HereMate folder is inaccessible or not writable by owner OAuth');
  }
  if (Array.isArray(folder.permissions) && folder.permissions.some(p => p.type === 'anyone' || p.type === 'domain')) fail('Drive folder has broad sharing');
}

export function validateOAuthCredentials(credentials) {
  const a = ['client_id','client_secret','refresh_token'];
  if (!credentials || a.some(k => typeof credentials[k] !== 'string' || !credentials[k].trim())) fail('OAuth credential JSON incomplete');
  if (Object.keys(credentials).sort().join(',') !== a.sort().join(',')) fail('unexpected OAuth credential JSON fields');
}

export function checkOAuthScope(scope) {
  const scopes = (scope || '').split(/\s+/).filter(Boolean);
  if (scopes.length !== 1 || scopes[0] !== DRIVE_SCOPE) fail('OAuth token must have only drive.file scope');
}

function assertHttp(response, msg) {
  if (!response.ok) fail(msg + ' (HTTP ' + response.status + ')');
}

async function requestJson(url, accessToken, fetcher=fetch) {
  const r=await fetcher(url, {headers:{Authorization:'Bearer ' + accessToken},redirect:'error'});
  assertHttp(r,'Google Drive metadata operation failed');
  return r.json();
}

export async function refreshAccessToken(credentials, fetcher=fetch) {
  validateOAuthCredentials(credentials);
  const form=new URLSearchParams({
    client_id:credentials.client_id,client_secret:credentials.client_secret,
    refresh_token:credentials.refresh_token,grant_type:'refresh_token'
  });
  const r=await fetcher('https://oauth2.googleapis.com/token',{
    method:'POST',body:form,headers:{'Content-Type':'application/x-www-form-urlencoded'},redirect:'error'
  });
  assertHttp(r,'Google OAuth refresh failed; check consent publishing and token expiry');
  const data=await r.json();
  if (typeof data.access_token !== 'string' || data.token_type?.toLowerCase() !== 'bearer') fail('invalid OAuth response');
  checkOAuthScope(data.scope);
  return data.access_token;
}

// Artifact links returned by Expo are HTTPS URLs on expo.dev. Expo may
// redirect them to cloud object storage or a CDN. Trust only a final HTTPS
// endpoint hosted by Expo or a recognized storage/CDN provider; do not
// silently accept arbitrary redirects or downgrade to HTTP.
export function validateEasArtifactDestination(origin, resolved) {
  let start, target;
  try { start=new URL(origin); target=new URL(resolved); }
  catch { fail('malformed EAS artifact download URL'); }
  if(start.protocol!=='https:' || start.hostname!=='expo.dev' ||
      !/^\\/artifacts\\/eas\\/[^/]+\\.apk$/.test(start.pathname) ||
      start.username || start.password) fail('unapproved EAS artifact origin');
  const host=target.hostname.toLowerCase();
  const approved=host==='expo.dev' ||
    host.endsWith('.expo.dev') ||
    host==='storage.googleapis.com' ||
    /^([a-z0-9-]+\\.)?s3(?:[.-][a-z0-9-]+)?\\.amazonaws\\.com$/.test(host) ||
    /^[a-z0-9-]+\\.cloudfront\\.net$/.test(host) ||
    (host==='eascdn.net' || host.endsWith('.eascdn.net')) ||
    /^[a-z0-9-]+\\.blob\\.core\\.windows\\.net$/.test(host);
  if(target.protocol!=='https:' || target.username || target.password || !approved)
    fail('unexpected EAS download redirect host: '+host+' (URL and query not logged)');
}

async function downloadApk(url,path,fetcher=fetch) {
  const r=await fetcher(url,{redirect:'follow'});
  assertHttp(r,'EAS APK download failed');
  validateEasArtifactDestination(url,r.url || url);
  if (!r.body) fail('empty EAS response');
  let size=0,sha=createHash('sha256'),md5=createHash('md5');
  await pipeline(Readable.fromWeb(r.body),new Transform({transform(chunk,_enc,done){
    size+=chunk.length;if(size>MAX_APK){done(Error('APK exceeds size limit'));return;}
    sha.update(chunk);md5.update(chunk);done(null,chunk);
  }}),createWriteStream(path,{mode:0o600}));
  const fh=await open(path,'r');
  const header=Buffer.alloc(4);
  try {await fh.read(header,0,4,0)}finally{await fh.close()}
  if(size < 1024 || header.toString('hex')!=='504b0304') fail('download is not a plausible APK ZIP');
  return {size,sha256:sha.digest('hex'),md5:md5.digest('hex')};
}

function listQuery(folderId,name) {
  const q="'"+folderId+"' in parents and name = '"+name.replaceAll("'","\\'")+"' and trashed = false";
  return 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
    q,fields:'nextPageToken,files(id,name,size,md5Checksum,parents,appProperties,webViewLink,shared)',
    pageSize:'100'
  });
}

export function assertStoredMetadata(meta, folderId, fileName, hashes, props) {
  if (!meta?.id || meta.name!==fileName || meta.shared!==false ||
      !meta.parents?.includes(folderId) || Number(meta.size)!==hashes.size ||
      meta.md5Checksum!==hashes.md5 ||
      meta.appProperties?.sha256!==hashes.sha256 ||
      meta.appProperties?.buildId!==props.buildId ||
      meta.appProperties?.gitSha!==props.gitSha ||
      meta.appProperties?.kind!==props.kind) fail('Drive file metadata/checksum mismatch');
}

async function verifyDownloadedContent(id, accessToken, expected, fetcher=fetch) {
  const r=await fetcher('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media',{
    headers:{Authorization:'Bearer '+accessToken},redirect:'error'
  });
  assertHttp(r,'Drive read-after-write verification failed');
  if(!r.body)fail('empty Drive file response');
  let size=0;const hash=createHash('sha256');
  for await (const bytes of Readable.fromWeb(r.body)) {
    size+=bytes.length;if(size>MAX_APK)fail('Drive verification exceeded size limit');
    hash.update(bytes);
  }
  if(size!==expected.size || hash.digest('hex')!==expected.sha256)fail('Drive read-back SHA-256 mismatch');
}

async function upsertVerified({accessToken,folderId,fileName,localPath,hashes,props,mimeType,fetcher=fetch}) {
  const headers={Authorization:'Bearer '+accessToken};
  const list=await requestJson(listQuery(folderId,fileName),accessToken,fetcher);
  if(list.nextPageToken || !Array.isArray(list.files) || list.files.length>1)fail('ambiguous Drive destination file name');
  let result=list.files[0];
  if(result) {
    assertStoredMetadata(result,folderId,fileName,hashes,props);
  } else {
    const meta={name:fileName,mimeType,parents:[folderId],description:'HereMate staging-only verified artifact; not a production release',
      appProperties:{sha256:hashes.sha256,buildId:props.buildId,gitSha:props.gitSha,kind:props.kind}};
    const start=await fetcher('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,md5Checksum,parents,appProperties,webViewLink,shared',{
      method:'POST',headers:{...headers,'Content-Type':'application/json; charset=UTF-8',
        'X-Upload-Content-Type':mimeType,'X-Upload-Content-Length':String(hashes.size)},
      body:JSON.stringify(meta),redirect:'error'
    });
    assertHttp(start,'Drive resumable upload initialization failed (existing folder may need Picker grant)');
    const session=start.headers.get('location');
    if(!session || new URL(session).protocol!=='https:' || new URL(session).hostname!=='www.googleapis.com')fail('untrusted resumable session URL');
    const put=await fetcher(session,{method:'PUT',
      headers:{'Content-Type':mimeType,'Content-Length':String(hashes.size)},
      body:createReadStream(localPath),duplex:'half',redirect:'error'});
    assertHttp(put,'Drive resumable upload failed; retry workflow after checking destination');
    result=await put.json();
    assertStoredMetadata(result,folderId,fileName,hashes,props);
  }
  // Re-fetch metadata AND file content; Drive MD5 alone is not a SHA-256 proof.
  const actual=await requestJson('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(result.id)+'?fields=id,name,size,md5Checksum,parents,appProperties,webViewLink,shared',accessToken,fetcher);
  assertStoredMetadata(actual,folderId,fileName,hashes,props);
  await verifyDownloadedContent(actual.id,accessToken,hashes,fetcher);
  return {id:actual.id,url:actual.webViewLink || 'https://drive.google.com/file/d/'+actual.id+'/view'};
}

export function computeBufferHashes(buffer) {
  return {size:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),md5:createHash('md5').update(buffer).digest('hex')};
}

export async function publish({buildManifestPath,credentialsPath,outPath,tempApkPath,sha,folderId,expectedEmail,fetcher=fetch}) {
  const build=validateBuildManifest(JSON.parse(await readFile(buildManifestPath,'utf8')),sha);
  if(folderId!==DRIVE_FOLDER_ID)fail('unexpected Drive destination folder');
  const creds=JSON.parse(await readFile(credentialsPath,'utf8'));
  const token=await refreshAccessToken(creds,fetcher);
  const about=await requestJson('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',token,fetcher);
  const folder=await requestJson('https://www.googleapis.com/drive/v3/files/'+folderId+'?fields=id,name,mimeType,shared,capabilities(canAddChildren),owners(emailAddress),permissions(type,role)',token,fetcher);
  checkAccess({about,folder,expectedEmail,folderId});
  try {
    const apkHash=await downloadApk(build.artifactUrl,tempApkPath,fetcher);
    const props={buildId:build.buildId,gitSha:sha,kind:'apk'};
    const apkName='HereMate-staging-'+build.buildId+'.apk';
    const apk=await upsertVerified({accessToken:token,folderId,fileName:apkName,localPath:tempApkPath,
      hashes:apkHash,props,mimeType:'application/vnd.android.package-archive',fetcher});
    const delivered={
      schemaVersion:1,app:'HereMate',environment:'staging',productionAuthorized:false,
      expoProjectId:EAS_PROJECT_ID,sourceSha:sha,easBuildId:build.buildId,profile:'android-preview',
      apk:{fileName:apkName,bytes:apkHash.size,sha256:apkHash.sha256,md5:apkHash.md5,driveFileId:apk.id,driveUrl:apk.url},
      security:{exception:'STAGING ONLY; NOT PATCHED',expiresOn:'2026-11-20',
        advisories:['GHSA-vfj7-8cjw-p6xm','GHSA-86w9-cpqp-85rv']},
      buildVerifiedAt:build.verifiedAt
    };
    const bytes=Buffer.from(JSON.stringify(delivered,null,2)+'\n');
    const manifestPath=outPath+'.upload.json';
    await writeFile(manifestPath,bytes,{mode:0o600});
    const manifestName='HereMate-staging-'+build.buildId+'-build-manifest.json';
    const manifest=await upsertVerified({accessToken:token,folderId,fileName:manifestName,
      localPath:manifestPath,hashes:computeBufferHashes(bytes),
      props:{buildId:build.buildId,gitSha:sha,kind:'manifest'},
      mimeType:'application/json',fetcher});
    delivered.manifestDriveId=manifest.id;
    await writeFile(outPath,JSON.stringify(delivered,null,2)+'\n',{mode:0o600});
    await rm(manifestPath,{force:true});
    console.log('M0.4 PRIVATE DELIVERY VERIFIED: APK '+apkHash.size+' bytes SHA-256 '+apkHash.sha256);
    console.log('Drive files verified: APK '+apk.id+' Manifest '+manifest.id+'; permissions remain Restricted');
    return delivered;
  } finally {
    await rm(outPath+'.upload.json',{force:true});
    await rm(tempApkPath,{force:true});
  }
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  publish({buildManifestPath:process.argv[2],credentialsPath:process.env.DRIVE_OAUTH_SECRET_JSON_FILE,
    outPath:process.argv[3],tempApkPath:process.env.RUNNER_TEMP+'/heremate.apk',sha:process.env.GITHUB_SHA,
    folderId:process.env.DRIVE_FOLDER_ID,expectedEmail:process.env.DRIVE_EXPECTED_OWNER_EMAIL})
    .catch(e=>{console.error(e.message);process.exitCode=1});
}
