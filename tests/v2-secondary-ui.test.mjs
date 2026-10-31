import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RADIUS_MIN_M,RADIUS_MAX_M,RADIUS_STEP_M,clampRadius} from '../src/app/screens/placeRules.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('place radius is 100–1000 m in 50 m steps', () => {
  assert.deepEqual([RADIUS_MIN_M,RADIUS_MAX_M,RADIUS_STEP_M],[100,1000,50]);
  assert.equal(clampRadius(20),100);
  assert.equal(clampRadius(5000),1000);
  assert.equal(clampRadius(274),250);
  assert.equal(clampRadius(276),300);
  assert.equal(clampRadius(Number.NaN),200);
});

test('places screen gates Live on the geofence capability and shows the privacy note', () => {
  const src=read('src/app/screens/Places.tsx');
  assert.match(src,/caps\.geofences/);
  assert.match(src,/ComingSoon/);
  assert.match(src,/t\('placesPrivacyNote'\)/);
  assert.match(src,/t\('waitingFor'/);
  assert.match(src,/places\.propose\(/);
  assert.match(src,/places\.decide\(/);
});

test('background consent offers exactly the 1/4/8 h choices, defaulting to 1 h', () => {
  const src=read('src/app/screens/BackgroundConsent.tsx');
  assert.match(src,/BACKGROUND_HOURS\.map/);
  assert.match(src,/useState<BackgroundHours>\(1\)/);
  assert.match(src,/location\.startBackground\(/);
  assert.match(src,/BACKGROUND_PERMISSION_DENIED/);
});

test('me screen: stop-all calls location.stopAll; background switch is Coming soon without the capability', () => {
  const src=read('src/app/screens/Me.tsx');
  assert.match(src,/location\.stopAll\(\)/);
  assert.match(src,/t\('stopAllNow'\)/);
  assert.match(src,/caps\.backgroundSharing/);
  assert.match(src,/ComingSoon/);
  assert.match(src,/t\('shareWhenClosed'\)/);
});

test('add friend handles code entry and incoming/outgoing requests', () => {
  const src=read('src/app/screens/AddFriend.tsx');
  assert.match(src,/friends\.sendRequest\(/);
  assert.match(src,/friends\.respond\(/);
  assert.match(src,/t\('incomingRequests'\)/);
});

test('permission primer explains before Android asks, with an open-settings fallback', () => {
  const src=read('src/app/screens/PermissionPrimer.tsx');
  for(const k of ['primerForegroundTitle','primerBackgroundTitle','primerNotificationsTitle','openSettings'])
    assert.match(src,new RegExp(`'${k}'`));
  assert.match(src,/Linking\.openSettings\(\)/);
});

test('shell routes every stack screen', () => {
  const src=read('src/app/Shell.tsx');
  for(const s of ['AddFriend','NewPlace','PermissionPrimer','BackgroundConsent','PlacesSheet','MeScreen'])
    assert.match(src,new RegExp('<'+s+'\\b'),s);
});

test('I5: Me explains when closed-app sharing stopped by itself, with battery guidance', () => {
  const src=read('src/app/screens/Me.tsx');
  assert.match(src,/sharing\.lastBackgroundStop/);
  assert.match(src,/t\('bgStoppedAt'/);
  assert.match(src,/t\('bgBatteryHint'\)/);
});
