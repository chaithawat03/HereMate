import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const file = new URL('../scripts/m0-5-inventory.sh', import.meta.url);
const src = readFileSync(file, 'utf8');

test('M0.5 Cloud Shell inventory parses and remains strictly read-only', () => {
  execFileSync('bash', ['-n', file.pathname]);
  assert.match(src, /EXPECTED_PROJECT_ID="heremate"/);
  assert.match(src, /EXPECTED_PROJECT_NUMBER="976775896533"/);
  assert.match(src, /FIREBASE_PROJECT_LINK=UNVERIFIED/);
  assert.match(src, /BUDGET_ALERTS=UNVERIFIED/);
  assert.match(src, /PRODUCTION_DEPLOYMENT=NOT_AUTHORIZED/);
  assert.doesNotMatch(src, /gcloud\s+(?:config set|services enable|projects create|run deploy|secrets versions access|secrets create|firebase deploy)/);
});

test('wrong GCP project fails before reading any project resources', () => {
  const process = spawnSync('bash', [file.pathname, 'production'], { encoding:'utf8' });
  assert.equal(process.status, 2);
  assert.match(process.stderr, /BLOCKED/);
});

test('unexpected project number fails closed and never prints private metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'heremate-m05-'));
  try {
    const stub=join(dir,'gcloud');
    writeFileSync(stub, '#!/bin/sh\nprintf "999999999999\\n"\n');
    chmodSync(stub, 0o755);
    const process = spawnSync('bash', [file.pathname], {
      encoding:'utf8', env:{...globalThis.process.env, PATH:dir+':'+globalThis.process.env.PATH}
    });
    assert.equal(process.status,2);
    assert.match(process.stderr,/project number mismatch/);
    assert.doesNotMatch(process.stdout,/BILLING_ENABLED|DRIVE_OAUTH/);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
