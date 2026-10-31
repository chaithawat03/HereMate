import test from 'node:test';
import assert from 'node:assert/strict';
import {ringColor,ageLabel,circlePolygon} from '../src/map/status.ts';
import {palette} from '../src/app/theme.ts';
import {S,format} from '../src/app/strings.ts';
import {distanceM} from '../src/data/demo/demoWorld.ts';

test('status ring colors are exact', () => {
  assert.equal(ringColor('LIVE'),'#2FB57C');
  assert.equal(ringColor('STALE'),'#C9A34A');
  assert.equal(ringColor('OFFLINE'),'#A0AAB4');
  assert.equal(ringColor('SHARING_OFF'),'#A0AAB4');
});

test('age labels in Thai and English', () => {
  assert.equal(ageLabel(10_000,'th'),'ตอนนี้');
  assert.equal(ageLabel(10_000,'en'),'now');
  assert.equal(ageLabel(2*60_000,'th'),'2 นาทีที่แล้ว');
  assert.equal(ageLabel(2*60_000,'en'),'2 min ago');
  assert.equal(ageLabel(3*3_600_000,'th'),'3 ชม.ที่แล้ว');
  assert.equal(ageLabel(3*3_600_000,'en'),'3 h ago');
  assert.equal(ageLabel(-2000,'en'),'now');
  assert.equal(ageLabel(Number.NaN,'en'),'');
});

test('Thai and English dictionaries have identical, non-empty keys', () => {
  assert.deepEqual(Object.keys(S.th).sort(),Object.keys(S.en).sort());
  for(const lang of ['th','en'])
    for(const [k,v] of Object.entries(S[lang]))assert.ok(typeof v==='string'&&v.trim().length>0,lang+'.'+k);
  for(const k of ['tryDemo','emptyFriendsTitle','emptyFriendsBody','addFriend','placesPrivacyNote',
    'comingSoon','cantConnect','retry','stopAllNow','shareWhenClosed','waitingFor','demoBadge'])
    assert.ok(k in S.th,k);
  assert.equal(format(S.en.waitingFor,{name:'Mint'}),'Waiting for Mint to approve');
});

test('circlePolygon stays on the radius and closes', () => {
  const c={lat:13.7315,lng:100.544};
  const ring=circlePolygon(c,200);
  assert.equal(ring.length,49);
  assert.deepEqual(ring[0],ring[ring.length-1]);
  for(const [lng,lat] of ring)assert.ok(Math.abs(distanceM(c,{lat,lng})-200)<=1);
});

test('palette tokens match the spec', () => {
  const l=palette('light');
  assert.equal(l.ink,'#1D2228');assert.equal(l.secondary,'#6B7680');assert.equal(l.mapBase,'#EEF1F4');
  assert.equal(l.accent,'#2F7CF6');assert.equal(l.live,'#2FB57C');assert.equal(l.stale,'#C9A34A');
  assert.equal(l.off,'#A0AAB4');assert.equal(l.danger,'#D64545');
  const d=palette('dark');
  assert.equal(d.accent,'#2F7CF6');assert.notEqual(d.ink,l.ink);
});
