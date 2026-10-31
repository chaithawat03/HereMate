/**
 * Owner-approved, time-limited HereMate Android Staging TEST exception (approved 2026-10-22,
 * re-approved by the owner 2026-10-31 for HereMate v2: consented M2 sharing and the v2 Live
 * deadline-bound background sharing on Staging only). No Production.
 * Original M0.1 synthetic-only snapshot remains independently unchanged.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const error=message=>{throw Error('GUEST STAGING AUDIT BLOCKED: '+message);};
const approvedRoot=new Map([
  ['GHSA-vfj7-8cjw-p6xm','braces'],
  ['GHSA-86w9-cpqp-85rv','node-forge'],
  // Owner re-approval 2026-10-31: Expo build tooling (@expo/cli), present before and after v2.
  ['GHSA-7wch-p9px-956x','node-forge'],
  ['GHSA-jc66-7q78-782g','node-forge'],
  ['GHSA-8hrf-8g6f-7xwp','node-forge'],
  ['GHSA-hqq3-7jhf-c5jx','node-forge'],
  ['GHSA-5x38-2vff-x55p','node-forge'],
  ['GHSA-mrhx-c7xc-m3w5','zod']
]);
const requiredFiles=[
  'App.tsx','app.json','.gitignore','.easignore','eas.json','package.json','package-lock.json',
  'src/auth/firebaseGuest.ts','src/auth/GuestAuthGate.tsx',
  'src/auth/googleAccountFlow.ts','src/auth/googleAccountFirebase.ts',
  'src/auth/nativeGoogleSignIn.ts','src/auth/nativeGoogleSignIn.android.ts',
  'src/config/googleStaging.ts','google-services.json',
  'src/location/LocalLocationPanel.tsx','src/location/locationLogic.ts',
  'src/location/gpsLifecycle.ts',
  'src/profile/profileModel.ts','src/profile/firestoreProfile.ts','src/profile/UserProfilePanel.tsx',
  'src/ui/preferencesModel.ts','src/ui/PreferencesProvider.tsx',
  'src/friends/friendModel.ts','src/friends/firestoreFriends.ts','src/friends/FriendsPanel.tsx',
  'src/config/firebaseStaging.ts','src/types/firebase-auth-react-native.d.ts',
  'firebase/firestore.rules','.github/workflows/staging-eas-build.yml',
  'scripts/verify-release.mjs'
].sort();
export function verifyGuestSnapshot(policy,root=new URL('../',import.meta.url)){
  if(policy?.environment!=='staging' ||
     policy?.sourceScope!=='anonymous-guest-google-friends-consent-staging-only' ||
     policy?.approvedOn!=='2026-10-22' ||
     policy?.expiresOn!=='2026-11-20' ||
     policy?.trackingIssue!=='https://github.com/chaithawat03/HereMate/issues/12')
     error('missing explicit owner-approved Guest-only scope and expiry');
  if(Object.keys(policy.sourceHashes||{}).sort().join('|')!==requiredFiles.join('|'))
     error('exact Guest source manifest missing or unexpected');
  for(const path of requiredFiles){
    const body=readFileSync(new URL(path,root));
    const hash=createHash('sha1').update(Buffer.from('blob '+body.byteLength+'\0')).update(body).digest('hex');
    if(policy.sourceHashes[path]!==hash) error('Guest approved snapshot changed: '+path);
  }
}
export function evaluateGuestAudit(report,policy,now,app,eas){
  if(report?.auditReportVersion!==2||!report.vulnerabilities||!report.metadata?.vulnerabilities||report.error)
    error('npm audit v2 unavailable/invalid');
  if(policy?.environment!=='staging' ||
    policy?.sourceScope!=='anonymous-guest-google-friends-consent-staging-only' ||
    policy?.expiresOn!=='2026-11-20' ||
    !Array.isArray(policy.allowed)||policy.allowed.length!==approvedRoot.size)
    error('not the approved Guest-only policy');
  for(const entry of policy.allowed){
    if(approvedRoot.get(entry.id)!==entry.package ||
       typeof entry.reason!=='string' || entry.reason.length<24)
      error('unapproved root advisory');
  }
  if(new Set(policy.allowed.map(x=>x.id)).size!==approvedRoot.size)error('duplicate or missing advisories');
  if(now.getTime()>new Date(policy.expiresOn+'T23:59:59.999Z').getTime())
    error('Guest trial approval expired');
  const exp=app?.expo;
  const guest=eas?.build?.['android-guest-staging'];
  if(exp?.owner!=='smartyyys-team'||exp?.slug!=='heremate' ||
     exp?.extra?.environment!=='staging' ||
     exp?.android?.package!=='com.chaithawat03.heremate' ||
     eas?.build?.production!==undefined ||
     guest?.android?.buildType!=='apk'||guest?.distribution!=='internal' ||
     guest?.env?.EXPO_PUBLIC_ENVIRONMENT!=='staging'||
     guest?.env?.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST!=='true' ||
     guest?.env?.EXPO_PUBLIC_ENABLE_LOCAL_GPS!=='true' ||
     guest?.env?.EXPO_PUBLIC_ENABLE_M1_PROFILE!=='true' ||
     guest?.env?.EXPO_PUBLIC_ENABLE_M1_FRIENDS!=='true' ||
     guest?.env?.EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN!=='true' ||
     eas?.build?.['ios-guest-simulator']?.env?.EXPO_PUBLIC_ENABLE_M1_PROFILE!=='true' ||
     eas?.build?.['ios-guest-simulator']?.env?.EXPO_PUBLIC_ENABLE_LOCAL_GPS!=='true' ||
     eas?.build?.['android-preview']?.env?.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST!==undefined ||
     eas?.build?.['android-preview']?.env?.EXPO_PUBLIC_ENABLE_LOCAL_GPS!==undefined ||
     eas?.build?.['android-preview']?.env?.EXPO_PUBLIC_ENABLE_M1_PROFILE!==undefined ||
     eas?.build?.['android-preview']?.env?.EXPO_PUBLIC_ENABLE_M1_FRIENDS!==undefined ||
     eas?.build?.['ios-guest-simulator']?.env?.EXPO_PUBLIC_ENABLE_M1_FRIENDS!==undefined ||
     eas?.build?.['android-preview']?.env?.EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN!==undefined ||
     eas?.build?.['ios-guest-simulator']?.env?.EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN!==undefined ||
     !eas?.build?.['ios-guest-simulator']?.ios?.simulator)
      error('Guest build environment or original Demo profile mismatch');
  let roots=new Set();
  function collect(name,seen=new Set()){
    if(seen.has(name))return [];
    const v=report.vulnerabilities[name];
    if(!v||!Array.isArray(v.via))error('unresolved package path: '+name);
    const found=[];
    for(const x of v.via){
      if(typeof x==='string')found.push(...collect(x,new Set([...seen,name])));
      else if(x&&typeof x==='object' && x.severity==='critical')error('critical advisory in '+name);
      else if(x&&typeof x==='object' && x.severity==='high'){
        const id=/^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/.exec(x.url||'')?.[1];
        if(!id||approvedRoot.get(id)!==(x.name||name))error('new/unapproved HIGH in '+name);
        found.push(id);
      }else if(!x||typeof x!=='object'||typeof x.severity!=='string')error('malformed advisory');
    }
    return found;
  }
  const high=Object.entries(report.vulnerabilities).filter(([,v])=>['high','critical'].includes(v.severity));
  for(const [name,v] of high){
    if(v.severity==='critical')error('critical package '+name);
    const traced=collect(name);
    if(!traced.length)error('unknown high root: '+name);
    traced.forEach(x=>roots.add(x));
  }
  if(Number(report.metadata.vulnerabilities.high)!==high.length ||
     Number(report.metadata.vulnerabilities.critical)!==0)
      error('npm audit count mismatch');
  return {highAffectedPackages:high.length,rootAdvisories:[...roots].sort(),expiresOn:policy.expiresOn};
}
