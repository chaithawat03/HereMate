import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  DRIVE_FOLDER_ID,
  DRIVE_SCOPE,
  refreshAccessToken,
  checkAccess
} from './publish-staging-drive.mjs';

const invalid = reason => { throw Error('M0.4 PREFLIGHT BLOCKED: ' + reason); };

export async function preflightPrivateDrive({ credentials, folderId, expectedEmail, fetcher=fetch }) {
  if (folderId !== DRIVE_FOLDER_ID || !expectedEmail || !expectedEmail.includes('@')) invalid('missing or mismatched staging Drive destination');
  const accessToken = await refreshAccessToken(credentials, fetcher);
  const get = async (url) => {
    const response = await fetcher(url, {
      headers: { Authorization: 'Bearer ' + accessToken },
      redirect: 'error',
      method: 'GET'
    });
    if (!response.ok) invalid('Google Drive read-only metadata check returned HTTP ' + response.status);
    return response.json();
  };
  const about=await get('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
  const folder=await get('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(folderId)
    +'?fields=id,name,mimeType,shared,capabilities(canAddChildren),owners(emailAddress),permissions(type,role)');
  checkAccess({about,folder,expectedEmail,folderId});
  return { folderId, folderName:'HereMate',restricted:true,writable:true,oauthScope:DRIVE_SCOPE };
}

if (process.argv[1]===fileURLToPath(import.meta.url)) {
  (async()=>{
    const path=process.env.DRIVE_OAUTH_SECRET_JSON_FILE;
    if (!path) invalid('missing Secret Manager credential file');
    const credentials=JSON.parse(await readFile(path,'utf8'));
    const result=await preflightPrivateDrive({
      credentials,
      folderId:process.env.DRIVE_FOLDER_ID,
      expectedEmail:process.env.DRIVE_EXPECTED_OWNER_EMAIL
    });
    console.log('M0.4 READ-ONLY PREFLIGHT PASS: OAuth refresh and exact private writable folder verified');
    console.log('Validated Drive Folder ID: '+result.folderId+'; no APK build and no Drive file upload');
  })().catch(e=>{ console.error(e.message);process.exitCode=1; });
}
