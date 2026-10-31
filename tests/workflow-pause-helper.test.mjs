import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerPaused} from './helpers-workflow-pause.mjs';

const head='name: X\n\n# PAUSED by project owner 2026-10-28: reason.\non:\n';
test('ownerPaused: dispatch-only paused workflow is recognised',()=>{
  assert.equal(ownerPaused(head+'  workflow_dispatch:\n\npermissions:\n  contents: read\n'),true);
  assert.equal(ownerPaused('name: X\non:\n  pull_request:\n'),false);
});
test('ownerPaused: a "paused" header with an automatic trigger is rejected',()=>{
  assert.throws(()=>ownerPaused(head+'  workflow_dispatch:\n  pull_request:\n\njobs:\n'),/automatic triggers/);
  assert.throws(()=>ownerPaused(head+'  schedule:\n    - cron: "1 1 * * *"\n'),/automatic triggers/);
});
