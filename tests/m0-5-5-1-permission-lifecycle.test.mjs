import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldCancelForAppState } from '../src/location/gpsLifecycle.ts';
const panel=readFileSync(new URL('../src/location/LocalLocationPanel.tsx',import.meta.url),'utf8');
test('Android system permission activity cannot cancel a pending GPS start',()=>{
  assert.equal(shouldCancelForAppState('background',true),false);
  assert.equal(shouldCancelForAppState('active',true),false);
  assert.equal(shouldCancelForAppState('inactive',true),false);
});
test('real background still cancels an active GPS watcher',()=>{
  assert.equal(shouldCancelForAppState('background',false),true);
  assert.equal(shouldCancelForAppState('active',false),false);
});
test('permission resolves before watcher and waits for active foreground',()=>{
  assert.match(panel,/permissionPendingRef\.current = true;\s*const permission = await Location\.requestForegroundPermissionsAsync/);
  assert.match(panel,/appStateRef\.current !== 'active'/);
  assert.match(panel,/resumeWhenActiveRef\.current = resolve/);
  assert.match(panel,/if \(!current\(\)\) return;\s*permissionPendingRef\.current = false;\s*const watcher = await Location\.watchPositionAsync/);
  assert.match(panel,/if \(shouldCancelForAppState\(next, permissionPendingRef\.current\)\) stop\(\)/);
  assert.match(panel,/resumeWhenActiveRef\.current\?\.\(\)/);
  assert.doesNotMatch(panel,/startLocationUpdatesAsync|requestBackgroundPermissionsAsync|getFirestore|getDatabase|setDoc|updateDoc/);
});
