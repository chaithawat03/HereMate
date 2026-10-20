import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit } from '../scripts/check-staging-audit.mjs';

const policy={environment:'staging',sourceScope:'synthetic-data-only',expiresOn:'2026-11-20',allowed:[
  {id:'GHSA-vfj7-8cjw-p6xm',package:'braces',reason:'Only synthetic-data staging while upstream fix is unavailable'},
  {id:'GHSA-86w9-cpqp-85rv',package:'node-forge',reason:'Only synthetic-data staging while upstream fix is unavailable'}
]};
const app={expo:{extra:{environment:'staging'}}};
const eas={build:{'android-preview':{env:{EXPO_PUBLIC_ENVIRONMENT:'staging'}}}};
const advisory=(name,id,severity='high')=>({name,severity,url:'https://github.com/advisories/'+id});
function report() {
 const vulnerabilities={
  braces:{severity:'high',via:[advisory('braces','GHSA-vfj7-8cjw-p6xm')]},
  'node-forge':{severity:'high',via:[advisory('node-forge','GHSA-86w9-cpqp-85rv')]},
  micromatch:{severity:'high',via:['braces']},
  '@expo/cli':{severity:'high',via:['micromatch','node-forge']},
  uuid:{severity:'moderate',via:[advisory('uuid','GHSA-w5hq-g745-h8pq','moderate')]}
 };
 return {auditReportVersion:2,vulnerabilities,metadata:{vulnerabilities:{high:4,critical:0,moderate:1}}};
}
const check=(r,p=policy,now='2026-10-20',a=app,e=eas)=>evaluateAudit(r,p,new Date(now+'T12:00:00Z'),a,e);
test('accepts precisely two approved High advisories and transitive paths',()=>{
 const r=check(report());assert.equal(r.highPackages,4);assert.equal(r.advisories.length,2);
});
test('new High advisory in an approved package fails',()=>{
 const r=report();r.vulnerabilities.braces.via.push(advisory('braces','GHSA-aaaa-bbbb-cccc'));assert.throws(()=>check(r),/unapproved HIGH/);
});
test('new High package fails',()=>{
 const r=report();r.vulnerabilities.other={severity:'high',via:[advisory('other','GHSA-aaaa-bbbb-cccc')]};r.metadata.vulnerabilities.high++;
 assert.throws(()=>check(r),/unapproved HIGH/);
});
test('Critical vulnerability fails even if same package',()=>{
 const r=report();r.vulnerabilities.braces.severity='critical';r.metadata.vulnerabilities.high--;r.metadata.vulnerabilities.critical++;
 assert.throws(()=>check(r),/CRITICAL/);
});
test('missing root dependency fails',()=>{
 const r=report();r.vulnerabilities.micromatch.via=['not-found'];assert.throws(()=>check(r),/unresolved/);
});
test('time-bound exception expires',()=>assert.throws(()=>check(report(),policy,'2026-11-21'),/expired/));
test('changed allowlist fails',()=>{
 const changed=structuredClone(policy);changed.allowed[0].package='unknown';assert.throws(()=>check(report(),changed),/identity/);
});
test('production configuration or profile fails',()=>{
 assert.throws(()=>check(report(),policy,'2026-10-20',{expo:{extra:{environment:'production'}}}),/staging-only/);
 assert.throws(()=>check(report(),policy,'2026-10-20',app,{build:{...eas.build,production:{}}}),/staging-only/);
});
test('malformed audit or mismatch fails',()=>{
 const r=report();delete r.metadata;assert.throws(()=>check(r),/invalid/);
 const r2=report();r2.metadata.vulnerabilities.high=0;assert.throws(()=>check(r2),/mismatch/);
});
test('clean dependency audit passes even after expiry',()=>{
 const r={auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{high:0,critical:0}}};
 assert.deepEqual(check(r,policy,'2027-01-01').advisories,[]);
});
