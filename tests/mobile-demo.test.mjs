import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemoFriends, searchableFriends, visibleMapFriends } from '../src/domain/demo.ts';

test('dynamic friend counts from 0 to 1000', () => {
  for (const n of [0, 1, 5, 30, 100, 500, 1000]) assert.equal(makeDemoFriends(n).length, n);
  assert.equal(makeDemoFriends(2000).length, 1000);
  assert.equal(makeDemoFriends(-10).length, 0);
});

test('search matches names and stable usernames', () => {
  const f = makeDemoFriends(30);
  assert.equal(searchableFriends(f, '@friend0012').length, 1);
  assert.ok(searchableFriends(f, 'somchai').length > 0);
  assert.equal(searchableFriends(f, 'NOT_FOUND').length, 0);
});

test('map hides offline and stopped-sharing friend markers', () => {
  const f = makeDemoFriends(30);
  assert.ok(visibleMapFriends(f, true).length > 0);
  assert.ok(visibleMapFriends(f, true).every(x => x.status === 'LIVE' || x.status === 'STALE'));
  assert.equal(visibleMapFriends(f, false).length, 0);
});

test('friend status filters do not create artificial limits', () => {
  const f = makeDemoFriends(1000);
  assert.equal(searchableFriends(f, '', 'LIVE').length, 400);
  assert.equal(searchableFriends(f, '', 'SHARING_OFF').length, 200);
});
