import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {initialNav,navReducer} from '../src/app/nav.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const walk=dir=>readdirSync(new URL('../'+dir,import.meta.url),{withFileTypes:true})
  .flatMap(e=>e.isDirectory()?walk(dir+'/'+e.name):[dir+'/'+e.name]);

test('nav: push/pop, tab switch resets the stack, pop on empty is a no-op', () => {
  let s=initialNav;
  assert.deepEqual(s,{tab:'friends',stack:[]});
  s=navReducer(s,{type:'push',route:{screen:'friend',id:'mint'}});
  s=navReducer(s,{type:'push',route:{screen:'addFriend'}});
  assert.deepEqual(s.stack.map(r=>r.screen),['friend','addFriend']);
  s=navReducer(s,{type:'pop'});
  assert.deepEqual(s.stack,[{screen:'friend',id:'mint'}]);
  s=navReducer(s,{type:'tab',tab:'places'});
  assert.deepEqual(s,{tab:'places',stack:[]});
  assert.deepEqual(navReducer(s,{type:'pop'}),s);
  s=navReducer(s,{type:'tab',tab:'places',then:{screen:'newPlace',friendId:'bam'}});
  assert.deepEqual(s,{tab:'places',stack:[{screen:'newPlace',friendId:'bam'}]});
});

test('nav: pushing the same friend card again replaces it instead of stacking', () => {
  let s=navReducer(initialNav,{type:'push',route:{screen:'friend',id:'mint'}});
  s=navReducer(s,{type:'push',route:{screen:'friend',id:'ton'}});
  assert.deepEqual(s.stack,[{screen:'friend',id:'ton'}]);
});

test('screens only reach data through useHereMate (no direct Firebase, transports or sources)', () => {
  const files=walk('src/app').filter(f=>/\.(ts|tsx)$/.test(f));
  assert.ok(files.length>=8,'app files exist');
  for(const f of files){
    const src=read(f);
    assert.doesNotMatch(src,/from ['"]firebase/,f);
    assert.doesNotMatch(src,/from ['"][./]*\/(auth|friends|profile|geofences)\//,f);
    assert.doesNotMatch(src,/location\/m2|data\/demo|data\/live/,f);
  }
});

test('sign-in hides phone login behind the capability and offers one-tap demo', () => {
  const src=read('src/app/screens/SignIn.tsx');
  assert.match(src,/caps\.phoneLogin\s*&&/);
  assert.match(src,/t\('tryDemo'\)/);
  assert.match(src,/switchTo\('demo'\)/);
});

test('empty_and_long_name_rendering: single-line names and an inviting empty state', () => {
  const home=read('src/app/screens/Home.tsx');
  assert.match(home,/numberOfLines=\{1\}/);
  for(const k of ['emptyFriendsTitle','emptyFriendsBody','addFriend'])assert.match(home,new RegExp(`t\\('${k}'\\)`));
  const detail=read('src/app/screens/FriendDetail.tsx');
  assert.match(detail,/numberOfLines=\{1\}/);
});

test('home shows a reconnect banner and never draws pins without coordinates', () => {
  const home=read('src/app/screens/Home.tsx');
  assert.match(home,/t\('cantConnect'\)/);
  assert.match(home,/\.at\s*&&|\.at\s*!==?\s*null|p\.at\s*\?/);
});

test('friend detail: wave falls back to Coming soon and directions use the existing geo handoff', () => {
  const detail=read('src/app/screens/FriendDetail.tsx');
  assert.match(detail,/caps\.wave/);
  assert.match(detail,/ComingSoon/);
  assert.match(detail,/androidGeoUri/);
});
