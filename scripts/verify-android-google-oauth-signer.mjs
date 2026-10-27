/**
 * Fail-closed Android APK signer + installed package / Google OAuth preflight.
 *
 * Consumes ONLY the output of a successful:
 *   apksigner verify --verbose --print-certs app-release.apk
 * The calling workflow MUST check apksigner AND aapt exit codes first.
 * No keystore, signing password, Google ID token or Firebase credential is read.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {googleStagingAndroidSha1} from '../src/config/googleStaging.ts';

const fail=()=>{throw Error('ANDROID_GOOGLE_OAUTH_SIGNER_MISMATCH_OR_UNVERIFIED');};
const normalizeSha1=value=>{
  if(typeof value!=='string')fail();
  const hex=value.replaceAll(':','').toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(hex))fail();
  return hex;
};

/** Pure parser for reproducible offline regression tests. */
export function verifyAndroidGoogleOAuthSigner(apksignerOutput,registeredSha1=googleStagingAndroidSha1){
  if(typeof apksignerOutput!=='string'||apksignerOutput.length>131072||
     /DOES NOT VERIFY/i.test(apksignerOutput))fail();
  const digests=[...apksignerOutput.matchAll(
    /^\s*Signer #(\d+) certificate SHA-1 digest:\s*([0-9a-fA-F:]+)\s*$/gm
  )];
  // A single, explicitly numbered signer is required: never accept one
  // matching cert hidden among several APK signers.
  if(digests.length!==1||digests[0][1]!=='1')fail();
  const count=/^\s*Number of signers:\s*(\d+)\s*$/m.exec(apksignerOutput);
  if(count&&count[1]!=='1')fail();
  const apkSha1=normalizeSha1(digests[0][2]);
  if(apkSha1!==normalizeSha1(registeredSha1))fail();
  return Object.freeze({status:'MATCH',signerCount:1,sha1:apkSha1});
}


/**
 * Google Android OAuth identifies the app by BOTH signing SHA-1 and installed
 * package name. Source app.json alone cannot attest the compiled APK's ID.
 * Consume successful `aapt dump badging app-release.apk` output; reject
 * missing, ambiguous, duplicated or unexpected package declarations.
 */
export function verifyAndroidGoogleOAuthPackage(aaptOutput){
  if(typeof aaptOutput!=='string'||aaptOutput.length>131072)fail();
  const packages=[...aaptOutput.matchAll(/^package:\s+name='([^'\r\n]+)'(?:\s|$)/gm)];
  if(packages.length!==1||packages[0][1]!=='com.chaithawat03.heremate')fail();
  return Object.freeze({status:'MATCH',packageName:packages[0][1]});
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4)fail();
    const raw=readFileSync(process.argv[2],'utf8');
    verifyAndroidGoogleOAuthSigner(raw);
    verifyAndroidGoogleOAuthPackage(readFileSync(process.argv[3],'utf8'));
    process.stdout.write('ANDROID_GOOGLE_OAUTH_SIGNER_AND_PACKAGE_MATCH: PASS\n');
  }catch{
    // Do not leak local file paths, certificate details, tokens or stack traces.
    process.stderr.write('ANDROID_GOOGLE_OAUTH_SIGNER_MISMATCH_OR_UNVERIFIED\n');
    process.exitCode=1;
  }
}
