import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getResponsiveLayout } from '../src/ui/layout.ts';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('cover display keeps single-column layout with adaptive map', () => {
  const narrow = getResponsiveLayout(393, 852);
  assert.equal(narrow.isExpanded, false);
  assert.equal(narrow.mapHeight, 324);
  assert.ok(narrow.mapHeight > 290);
});
test('unfolded window enables centered two-column friends and wider map', () => {
  const inner = getResponsiveLayout(768, 884);
  assert.equal(inner.isExpanded, true);
  assert.equal(inner.mapHeight, 424);
  assert.ok(inner.mapHeight > getResponsiveLayout(393, 852).mapHeight);
});
test('window resizing returns correct mode, within bounds', () => {
  for (const [width,height] of [[359,780],[600,760],[980,900],[1360,320],[0,0],[Infinity,NaN]]) {
    const value=getResponsiveLayout(width,height);
    assert.ok(Number.isInteger(value.mapHeight));
    assert.ok(value.mapHeight >= 300 && value.mapHeight <= 520);
  }
  assert.equal(getResponsiveLayout(599,750).isExpanded,false);
  assert.equal(getResponsiveLayout(600,750).isExpanded,true);
});
test('one SafeAreaView root applies Android StatusBar inset once to Demo and Guest', () => {
  const app=read('App.tsx');
  const gate=read('src/auth/GuestAuthGate.tsx');
  assert.match(app,/StatusBar\.currentHeight/);
  assert.match(app,/Platform\.OS === 'android'/);
  assert.match(app,/SafeAreaView style=\{\{flex:1,backgroundColor:c\.background,paddingTop:androidTopInset\}\}/);
  assert.match(app,/useWindowDimensions\(\)/);
  assert.match(app,/getResponsiveLayout\(width, height\)/);
  assert.match(app,/height: mapHeight/);
  assert.match(app,/isExpanded && s\.friendGrid/);
  assert.doesNotMatch(gate,/SafeAreaView/);
  assert.match(gate,/maxWidth:560/);
});
