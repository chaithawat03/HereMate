import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {verifyGuestSnapshot,evaluateGuestAudit} from './check-guest-staging-audit.mjs';

const HIGH = new Set(['high','critical']);
const error = message => { throw new Error('STAGING AUDIT BLOCKED: ' + message); };
const allowed = new Map([['GHSA-vfj7-8cjw-p6xm','braces'],['GHSA-86w9-cpqp-85rv','node-forge']]);

export function verifyM01Snapshot(policy, root = new URL('../', import.meta.url)) {
  const paths = ['App.tsx','app.json','eas.json','index.ts','package.json','package-lock.json','src/domain/demo.ts'];
  if (!policy.sourceHashes || Object.keys(policy.sourceHashes).sort().join('|') !== paths.sort().join('|')) error('approved M0.1 source manifest missing');
  for (const path of paths) {
    const data = readFileSync(new URL(path,root));
    const digest = createHash('sha1').update(Buffer.from('blob '+data.byteLength+'\0')).update(data).digest('hex');
    if (digest !== policy.sourceHashes[path]) error('M0.1 approved source changed: '+path);
  }
}

export function evaluateAudit(report, policy, now, app, eas) {
  if (report?.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities || report.error) error('invalid or unavailable npm audit v2 report');
  if (policy?.environment !== 'staging' || policy?.sourceScope !== 'synthetic-data-only' || !Array.isArray(policy.allowed) || policy.allowed.length !== 2) error('unapproved exception policy');
  if (app?.expo?.extra?.environment !== 'staging' || eas?.build?.production !== undefined || eas?.build?.['android-preview']?.env?.EXPO_PUBLIC_ENVIRONMENT !== 'staging') error('environment is not staging-only');
  const ids = new Set();
  for (const row of policy.allowed) {
    if (allowed.get(row.id) !== row.package || ids.has(row.id) || typeof row.reason !== 'string' || row.reason.length < 20) error('unexpected approved advisory identity');
    ids.add(row.id);
  }
  if (ids.size !== allowed.size) error('missing approved advisory identity');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.expiresOn)) error('invalid expiry date');
  const expires = new Date(policy.expiresOn+'T23:59:59.999Z');
  if (!Number.isFinite(expires.getTime())) error('invalid expiry');
  const roots = new Set();
  function collect(name, visited = new Set()) {
    if (visited.has(name)) return [];
    const v = report.vulnerabilities[name];
    if (!v || !Array.isArray(v.via)) error('unresolved vulnerable path: '+name);
    const visiting = new Set([...visited,name]);
    const found = [];
    for (const entry of v.via) {
      if (typeof entry === 'string') found.push(...collect(entry,visiting));
      else if (entry && typeof entry === 'object' && HIGH.has(entry.severity)) {
        const id = /^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/.exec(entry.url||'')?.[1];
        const pkg = entry.name || name;
        if (entry.severity === 'critical') error('CRITICAL '+pkg);
        if (!id || allowed.get(id) !== pkg) error('new/unapproved HIGH finding in '+pkg+' ('+(id||'unknown')+')');
        found.push(pkg+':'+id);
      } else if (!entry || typeof entry !== 'object' || typeof entry.severity !== 'string') {
        error('malformed advisory in '+name);
      }
    }
    return found;
  }
  const highPackages = Object.entries(report.vulnerabilities).filter(([,v])=>HIGH.has(v.severity));
  for (const [name,v] of highPackages) {
    if (v.severity === 'critical') error('CRITICAL dependency '+name);
    const found = collect(name);
    if (!found.length) error('HIGH without approved root in '+name);
    for (const id of found) roots.add(id);
  }
  if (Number(report.metadata.vulnerabilities.high) !== highPackages.length || Number(report.metadata.vulnerabilities.critical) !== 0) error('audit count mismatch');
  if (roots.size && now.getTime() > expires.getTime()) error('exception expired on '+policy.expiresOn);
  return { highPackages:highPackages.length, advisories:[...roots].sort(), expiresOn:policy.expiresOn };
}

function run() {
  const policy = JSON.parse(readFileSync(new URL('../security/staging-exceptions.json',import.meta.url),'utf8'));
  const app = JSON.parse(readFileSync(new URL('../app.json',import.meta.url),'utf8'));
  const eas = JSON.parse(readFileSync(new URL('../eas.json',import.meta.url),'utf8'));
  const guest = Boolean(eas?.build?.['android-guest-staging']);
  // Preserve original M0.1 snapshot and allowlist for synthetic Demo builds.
  // Guest builds use a SEPARATE explicitly accepted narrow risk policy.
  const guestPolicy = guest ? JSON.parse(readFileSync(new URL('../security/guest-staging-exception.json',import.meta.url),'utf8')) : null;
  if(guest)verifyGuestSnapshot(guestPolicy);
  else verifyM01Snapshot(policy);
  let raw;
  try {
    raw = execFileSync('npm',['audit','--omit=dev','--audit-level=high','--json'],{encoding:'utf8',maxBuffer:24*1024*1024});
  } catch(e) {
    if (e.status !== 1 || !String(e.stdout||'').trim()) throw e;
    raw = e.stdout;
  }
  const result=guest ? evaluateGuestAudit(JSON.parse(raw),guestPolicy,new Date(),app,eas) : evaluateAudit(JSON.parse(raw),policy,new Date(),app,eas);
  const summary = 'STAGING ONLY '+(guest?'ANONYMOUS GUEST TRIAL':'SYNTHETIC DEMO')+': '+(guest?result.highAffectedPackages:result.highPackages)+' High-affected dependency records. Accepted root advisories: '+((guest?result.rootAdvisories:result.advisories).join(', ')||'none')+'. Expires: '+result.expiresOn+'. NOT PATCHED; STAGING ONLY (owner re-approved 2026-10-31 for consented sharing incl. v2 deadline-bound background sharing); PRODUCTION NOT AUTHORIZED.';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,'\n### Staging-only Security Exception\n'+summary+'\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { run(); } catch(e) { console.error(e.message);process.exitCode=1; }
}
