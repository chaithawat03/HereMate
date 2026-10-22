import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  evaluatePublishGate,evaluateReadGate,MAX_FIX_AGE_MS,MAX_SHARE_GRANT_LIFETIME_MS
} from '../src/location/m2SharingPolicy.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const a='m2owneruid000000001',b='m2vieweruid00000002',c='m2strangeruid000003',now=1800000000000;
const rel={senderUid:a,recipientUid:b,status:'accepted',senderConsent:true,recipientConsent:true};
const grant={ownerUid:a,enabled:true,expiresAtMs:now+60_000};
const fix={latitude:13.4,longitude:100.2,accuracyMeters:12,capturedAtMs:now-1000};
const pub={authenticatedOwnerUid:a,ownerUid:a,viewerUid:b,relationship:rel,grant,
  appInForeground:true,foregroundPermissionGranted:true,fix,nowMs:now};
const sub={authenticatedViewerUid:b,ownerUid:a,viewerUid:b,relationship:rel,grant,fix,nowMs:now};
const denies=(result,reason)=>assert.deepEqual(result,{allowed:false,reason});
test('fresh mutually consented explicit grant can pass only for authorized pair',()=>{
 assert.deepEqual(evaluatePublishGate(pub),{allowed:true,reason:'allowed'});
 assert.deepEqual(evaluateReadGate(sub),{allowed:true,reason:'allowed'});
});
test('default-off, revoked, expired, implausible grants always deny',()=>{
 denies(evaluatePublishGate({...pub,grant:null}),'share-off');
 denies(evaluateReadGate({...sub,grant:{...grant,enabled:false}}),'share-off');
 denies(evaluateReadGate({...sub,grant:{...grant,expiresAtMs:now}}),'grant-expired');
 denies(evaluateReadGate({...sub,grant:{...grant,expiresAtMs:now+MAX_SHARE_GRANT_LIFETIME_MS+1}}),'grant-expired');
 denies(evaluatePublishGate({...pub,grant:{...grant,ownerUid:b}}),'share-off');
});
test('mutual M1 consent and accepted membership are both mandatory',()=>{
 for(const status of ['pending','declined','cancelled','removed'])
  denies(evaluateReadGate({...sub,relationship:{...rel,status}}),'no-accepted-relationship');
 for(const consents of [{senderConsent:false,recipientConsent:true},{senderConsent:true,recipientConsent:false},{senderConsent:false,recipientConsent:false}])
  denies(evaluateReadGate({...sub,relationship:{...rel,...consents}}),'not-mutually-consented');
 denies(evaluateReadGate({...sub,relationship:null}),'no-accepted-relationship');
 denies(evaluateReadGate({...sub,relationship:{...rel,recipientUid:c}}),'no-accepted-relationship');
 denies(evaluateReadGate({...sub,viewerUid:a,authenticatedViewerUid:a}),'self');
});
test('a removed friendship denies previous recipients immediately, independent of remaining TTL',()=>{
 denies(evaluateReadGate({...sub,relationship:{...rel,status:'removed'}}),'no-accepted-relationship');
 denies(evaluateReadGate({...sub,relationship:{...rel,senderConsent:false,recipientConsent:false}}),'not-mutually-consented');
});
test('owner and recipient identities never interchangeable',()=>{
 denies(evaluatePublishGate({...pub,authenticatedOwnerUid:b}),'not-authenticated');
 denies(evaluatePublishGate({...pub,authenticatedOwnerUid:null}),'not-authenticated');
 denies(evaluateReadGate({...sub,authenticatedViewerUid:a}),'not-authenticated');
 denies(evaluateReadGate({...sub,authenticatedViewerUid:null}),'not-authenticated');
 denies(evaluateReadGate({...sub,viewerUid:c,authenticatedViewerUid:c}),'no-accepted-relationship');
});
test('foreground location permission and fresh accurate fix are mandatory',()=>{
 denies(evaluatePublishGate({...pub,appInForeground:false}),'not-foreground');
 denies(evaluatePublishGate({...pub,foregroundPermissionGranted:false}),'no-foreground-permission');
 denies(evaluatePublishGate({...pub,fix:null}),'no-fresh-fix');
 denies(evaluateReadGate({...sub,fix:{...fix,capturedAtMs:now-MAX_FIX_AGE_MS-1}}),'no-fresh-fix');
 denies(evaluateReadGate({...sub,fix:{...fix,capturedAtMs:now+5001}}),'no-fresh-fix');
 for(const invalid of [
  {...fix,latitude:91},{...fix,longitude:-181},
  {...fix,latitude:Infinity},{...fix,capturedAtMs:0},
 ])denies(evaluateReadGate({...sub,fix:invalid}),'no-fresh-fix');
 denies(evaluateReadGate({...sub,fix:{...fix,accuracyMeters:Number.NaN}}),'poor-accuracy');
 denies(evaluateReadGate({...sub,fix:{...fix,accuracyMeters:201}}),'poor-accuracy');
 denies(evaluatePublishGate({...pub,fix:{...fix,accuracyMeters:-1}}),'poor-accuracy');
});
test('M2.0 cannot send, fetch, persist or start tracking: no production/permission changes',()=>{
 const policy=read('src/location/m2SharingPolicy.ts');
 assert.doesNotMatch(policy,/import\s+(?!type)|firebase\/|getFirestore\(|fetch\(|axios|watchPositionAsync|startLocationUpdatesAsync|setDoc\(|setItem\(/);
 const rules=read('firebase/firestore.rules');
 assert.match(rules,/match \/\{document=\*\*\}/);
 assert.match(rules,/allow read, write: if false/);
 const app=read('App.tsx');
 assert.doesNotMatch(app,/m2SharingPolicy|EXPO_PUBLIC_ENABLE_M2_SHARING/);
 const eas=JSON.parse(read('eas.json'));
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M2_SHARING,undefined);
 assert.equal(eas.build['android-preview'].env.EXPO_PUBLIC_ENABLE_M2_SHARING,undefined);
});
