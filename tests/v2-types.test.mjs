import test from 'node:test';
import assert from 'node:assert/strict';
import {statusForAge,BACKGROUND_HOURS,LIVE_MAX_AGE_MS} from '../src/data/types.ts';

test('a point is LIVE only while it is at most 30 s old', () => {
  assert.equal(LIVE_MAX_AGE_MS,30_000);
  assert.equal(statusForAge(0,true,true),'LIVE');
  assert.equal(statusForAge(30_000,true,true),'LIVE');
  assert.equal(statusForAge(30_001,true,true),'STALE');
});

test('sharing off and offline override freshness', () => {
  assert.equal(statusForAge(5,false,true),'SHARING_OFF');
  assert.equal(statusForAge(5,true,false),'OFFLINE');
  assert.equal(statusForAge(5,false,false),'SHARING_OFF');
});

test('invalid ages are never LIVE; small clock skew (≤5 s ahead) is tolerated', () => {
  assert.equal(statusForAge(Number.NaN,true,true),'STALE');
  assert.equal(statusForAge(-60_000,true,true),'STALE');
  assert.equal(statusForAge(-5_000,true,true),'LIVE');
  assert.equal(statusForAge(-5_001,true,true),'STALE');
});

test('background durations are exactly 1, 4 and 8 hours', () => {
  assert.deepEqual([...BACKGROUND_HOURS],[1,4,8]);
  assert.ok(Object.isFrozen(BACKGROUND_HOURS));
});
