/**
 * Advisory report only for PR review.
 * Never suppress a failing Security Gate or approve exceptions automatically.
 * Does not read credentials, Firebase users or run deployment commands.
 */
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';

let raw='';
try{
  raw=execFileSync('npm',['audit','--omit=dev','--audit-level=high','--json'],{
    encoding:'utf8',maxBuffer:20*1024*1024,stdio:['ignore','pipe','pipe']
  });
}catch(error){
  if(error.status!==1||!String(error.stdout||'').trim()) {
    console.error('AUDIT REPORT UNAVAILABLE: dependency registry request failed');
    process.exit(1);
  }
  raw=error.stdout;
}
let data;
try{data=JSON.parse(raw);}catch {console.error('AUDIT REPORT UNAVAILABLE: invalid response');process.exit(1);}
if(data.auditReportVersion!==2 || data.error || !data.metadata?.vulnerabilities || !data.vulnerabilities){
  console.error('AUDIT REPORT UNAVAILABLE: unsupported audit response');
  process.exit(1);
}
const counts=data.metadata.vulnerabilities;
const records=Object.entries(data.vulnerabilities).filter(([,v])=>['high','critical'].includes(v.severity));
const ids=new Set();
for(const [name,v] of records){
  for(const item of v.via||[]){
    if(item&&typeof item==='object'&&item.url?.startsWith('https://github.com/advisories/GHSA-')){
      ids.add(item.url.slice('https://github.com/advisories/'.length));
    }
  }
}
const lines=[
  'M0.5.3 Guest Login dependency inventory (DIAGNOSTIC ONLY; not approval)',
  'Production dependencies: critical='+counts.critical+' high='+counts.high+' moderate='+counts.moderate,
  'High/Critical affected packages: '+(records.map(([n])=>n).join(', ')||'none'),
  'Direct advisory IDs: '+([...ids].sort().join(', ')||'none'),
  'Current M0.1 synthetic-only Security Exception is NOT valid for real Guest Auth.',
  'Do not merge while the existing strict staging audit job is failing.'
];
console.log(lines.join('\n'));
if(process.env.GITHUB_STEP_SUMMARY){
 appendFileSync(process.env.GITHUB_STEP_SUMMARY,
   '\n### M0.5.3 Guest dependency inventory (no policy bypass)\n'+lines.map(l=>'- '+l).join('\n')+'\n');
}
