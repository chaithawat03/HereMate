import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ownerPaused} from './helpers-workflow-pause.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('M4 live TTL audit is bound to a single owner Issue #54 exact command',()=>{
 const wf=read('.github/workflows/m4-staging-readonly-ttl.yml');
 for(const gate of [
   "github.repository == 'chaithawat03/HereMate'",
   "github.ref == 'refs/heads/main'",
   "github.event_name == 'issue_comment'",
   "github.event.issue.number == 54",
   "github.event.issue.pull_request == null",
   "github.event.comment.body == '/heremate-check-m4-ttl'",
   "github.event.comment.user.login == 'chaithawat03'",
   "github.event.comment.user.id == 29879036",
   "github.event.comment.author_association == 'OWNER'",
   "github.event.sender.login == 'chaithawat03'",
   "github.actor == 'chaithawat03'",
   "environment: m2-staging-deploy"
 ])assert.ok(wf.includes(gate),'missing gate: '+gate);
 assert.match(wf,/service_account: \$\{\{ vars\.M2_STAGING_DEPLOY_SERVICE_ACCOUNT \}\}/);
 assert.match(wf,/workload_identity_provider: \$\{\{ vars\.M2_STAGING_WIF_PROVIDER \}\}/);
 assert.match(wf,/bash scripts\/m4-staging-ttl-preflight\.sh/);
});
test('M4 owner-command audit cannot mutate Cloud Run, Firestore TTL, IAM or billing',()=>{
 const wf=read('.github/workflows/m4-staging-readonly-ttl.yml');
 // Paused by owner: a bare workflow_dispatch trigger exists but the job still requires
 // github.event_name == 'issue_comment', so a dispatch can never run the audit.
 if(ownerPaused(wf))assert.match(wf,/github\.event_name == 'issue_comment' &&/);
 else assert.doesNotMatch(wf,/workflow_dispatch/);
 assert.doesNotMatch(wf,/pull_request:\s*\n/);
 assert.doesNotMatch(wf,/google-github-actions\/deploy-cloudrun|gcloud run deploy|gcloud builds submit|gcloud firestore fields ttls update|gcloud projects add-iam-policy-binding|gcloud services enable|firebase deploy/);
 assert.doesNotMatch(wf,/\$\{\{\s*secrets\./);
 assert.doesNotMatch(wf,/HEREMATE_M4_ENABLE_SERVER=true|EXPO_PUBLIC_ENABLE_M4_GEOFENCES=true/);
 const preflight=read('scripts/m4-staging-ttl-preflight.sh');
 assert.match(preflight,/gcloud firestore fields ttls list/);
 assert.match(preflight,/m4-staging-ttl-verify\.mjs/);
 const verify=read('scripts/m4-staging-ttl-verify.mjs');
 for(const col of ['private_geofence_zones','private_geofence_states',
     'private_geofence_rate_limits'])assert.ok(verify.includes(col));
 assert.match(verify,/ttlConfig\?\.state!=='ACTIVE'/);
});
