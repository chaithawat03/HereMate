import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyGuestSnapshot,evaluateGuestAudit} from '../scripts/check-guest-staging-audit.mjs';
import {verifyM01Snapshot} from '../scripts/check-staging-audit.mjs';

const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
const policy=JSON.parse(read('security/guest-staging-exception.json'));
const legacy=JSON.parse(read('security/staging-exceptions.json'));
const app=JSON.parse(read('app.json'));
const eas=JSON.parse(read('eas.json'));
const advisories=[
  ['braces','GHSA-vfj7-8cjw-p6xm'],
  ['node-forge','GHSA-86w9-cpqp-85rv']
];
function report(){
  const v={};
  for(const [name,id] of advisories)
    v[name]={severity:'high',via:[{name,severity:'high',url:'https://github.com/advisories/'+id}]};
  v.metro={severity:'high',via:['braces','node-forge']};
  return {auditReportVersion:2,vulnerabilities:v,metadata:{vulnerabilities:{high:3,critical:0}}};
}
const evaluate=(r=report(),p=policy,date='2026-10-21',a=app,e=eas)=>
  evaluateGuestAudit(r,p,new Date(date+'T12:00:00Z'),a,e);

test('Guest consent is exactly scoped, time bound and current source hashes match',()=>{
  assert.doesNotThrow(()=>verifyGuestSnapshot(policy));
  assert.equal(policy.sourceScope,'anonymous-guest-google-friends-consent-staging-only');
  assert.equal(policy.expiresOn,'2026-11-20');
  const tampered=structuredClone(policy);
  tampered.sourceHashes['App.tsx']='0'.repeat(40);
  assert.throws(()=>verifyGuestSnapshot(tampered),/snapshot changed/);
  assert.throws(()=>verifyGuestSnapshot({...policy,sourceScope:'all-users'}),/scope/);
});

test('old synthetic-only M0.1 manifest remains frozen, NOT relabeled',()=>{
  assert.equal(legacy.sourceScope,'synthetic-data-only');
  assert.equal(legacy.expiresOn,'2026-11-20');
  // M0.1 validation is still deliberately strict: changed App.tsx is not
  // silently made to look like the old synthetic-only snapshot.
  assert.throws(()=>verifyM01Snapshot(legacy),/approved source changed/);
});

test('only the two inherited Expo advisories can be tolerated for Guest trial',()=>{
  const result=evaluate();
  assert.deepEqual(result.rootAdvisories,advisories.map(x=>x[1]).sort());
  assert.equal(result.highAffectedPackages,3);
});

test('rejects any new high vulnerability or critical severity',()=>{
  const r=report();
  r.vulnerabilities.other={severity:'high',via:[{name:'other',severity:'high',url:'https://github.com/advisories/GHSA-zzzz-xxxx-1234'}]};
  r.metadata.vulnerabilities.high++;
  assert.throws(()=>evaluate(r),/unapproved HIGH/);
  const critical=report();
  critical.vulnerabilities.braces.severity='critical';
  critical.metadata.vulnerabilities.high--;
  critical.metadata.vulnerabilities.critical++;
  assert.throws(()=>evaluate(critical),/critical package/);
});

test('rejects production, guest disabled or unexpected demo profile changes',()=>{
  const prod=structuredClone(eas);prod.build.production={};
  assert.throws(()=>evaluate(report(),policy,'2026-10-21',app,prod),/Guest build environment/);
  const disabled=structuredClone(eas);
  disabled.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST='false';
  assert.throws(()=>evaluate(report(),policy,'2026-10-21',app,disabled),/Guest build environment/);
  const demo=structuredClone(eas);demo.build['android-preview'].env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST='true';
  assert.throws(()=>evaluate(report(),policy,'2026-10-21',app,demo),/Demo profile/);
});

test('rejects expired approval, forged allowlist or missing audit data',()=>{
  assert.throws(()=>evaluate(report(),policy,'2026-11-21'),/expired/);
  assert.throws(()=>evaluate(report(),{...policy,allowed:[]}),/policy/);
  assert.throws(()=>evaluate({auditReportVersion:2,vulnerabilities:{}}),/unavailable/);
});

test('owner re-approval 2026-10-31 covers the current Expo build-tool advisories only',()=>{
  assert.equal(policy.reapprovedOn,'2026-10-31');
  assert.match(policy.reapprovalNote,/HereMate v2/);
  const r=report();
  r.vulnerabilities['node-forge'].via.push(
    ...['GHSA-7wch-p9px-956x','GHSA-jc66-7q78-782g','GHSA-8hrf-8g6f-7xwp','GHSA-hqq3-7jhf-c5jx','GHSA-5x38-2vff-x55p']
      .map(id=>({name:'node-forge',severity:'high',url:'https://github.com/advisories/'+id})));
  r.vulnerabilities.zod={severity:'high',via:[{name:'zod',severity:'high',url:'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5'}]};
  r.metadata.vulnerabilities.high++;
  const result=evaluate(r);
  assert.deepEqual(result.rootAdvisories,['GHSA-5x38-2vff-x55p','GHSA-7wch-p9px-956x','GHSA-86w9-cpqp-85rv','GHSA-8hrf-8g6f-7xwp',
    'GHSA-hqq3-7jhf-c5jx','GHSA-jc66-7q78-782g','GHSA-mrhx-c7xc-m3w5','GHSA-vfj7-8cjw-p6xm']);
  // An approved ID attributed to a different package is still rejected.
  const wrong=report();
  wrong.vulnerabilities.braces.via=[{name:'braces',severity:'high',url:'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5'}];
  assert.throws(()=>evaluate(wrong),/unapproved HIGH/);
});
