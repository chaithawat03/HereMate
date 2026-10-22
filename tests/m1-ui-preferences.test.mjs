import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_PREFERENCES,PREFERENCES_STORAGE_KEY,palettes,parsePreferences,translate,translations} from '../src/ui/preferencesModel.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=read('App.tsx');
const provider=read('src/ui/PreferencesProvider.tsx');
const gate=read('src/auth/GuestAuthGate.tsx');
const gps=read('src/location/LocalLocationPanel.tsx');
const profile=read('src/profile/UserProfilePanel.tsx');

test('light theme and Thai are defaults; only well-formed settings are restored',()=>{
 assert.deepEqual(DEFAULT_PREFERENCES,{theme:'light',language:'th'});
 assert.deepEqual(parsePreferences(null),DEFAULT_PREFERENCES);
 assert.deepEqual(parsePreferences('garbage'),DEFAULT_PREFERENCES);
 assert.deepEqual(parsePreferences('{}'),DEFAULT_PREFERENCES);
 assert.deepEqual(parsePreferences(JSON.stringify({theme:'dark',language:'en'})),{theme:'dark',language:'en'});
 assert.deepEqual(parsePreferences(JSON.stringify({theme:'production',language:'fr'})),DEFAULT_PREFERENCES);
 assert.equal(PREFERENCES_STORAGE_KEY,'@heremate/ui-preferences/v1');
});
test('light/dark palettes have all matching tokens, contrast roles and distinct backgrounds',()=>{
 assert.deepEqual(Object.keys(palettes.light).sort(),Object.keys(palettes.dark).sort());
 assert.notEqual(palettes.light.background,palettes.dark.background);
 assert.notEqual(palettes.light.text,palettes.dark.text);
 assert.equal(palettes.light.surface,'#FFFFFF');
 for(const palette of Object.values(palettes)) for(const [key,value] of Object.entries(palette)){
   assert.match(value,/^#[0-9A-Fa-f]{6}$/,key);
 }
});
test('Thai and English have identical complete translation keys, interpolate safely',()=>{
 const th=Object.keys(translations.th).sort();
 const en=Object.keys(translations.en).sort();
 assert.deepEqual(en,th);
 assert.ok(th.length>=85, 'all screens must be translated');
 for(const [key,value] of Object.entries(translations.th)) {
   assert.ok(value.length>0,key);
   assert.ok(translations.en[key]?.length>0,key);
   assert.deepEqual([...value.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort(),
      [...translations.en[key].matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort(),
      'placeholder mismatch: '+key);
 }
 assert.equal(translate('th','mapShown',{shown:3,total:10}),'แสดง 3 จาก 10 จุดจำลอง');
 assert.equal(translate('en','mapShown',{shown:3,total:10}),'Showing 3 of 10 simulated pins');
 assert.match(translate('en','googleCollision'),/already in use/);
 assert.match(translate('th','gpsExplanation'),/ไม่ส่ง Firebase/);
 assert.match(translate('en','gpsExplanation'),/never shared/);
});
test('preference controls available before login and after login and settings remain local',()=>{
 assert.match(app,/<PreferencesProvider><AppScreen \/><\/PreferencesProvider>/);
 assert.ok(app.indexOf('<PreferenceControls />')<app.indexOf('guestEnabled ? <GuestAuthGate>'));
 assert.match(provider,/AsyncStorage\.getItem\(PREFERENCES_STORAGE_KEY\)/);
 assert.match(provider,/AsyncStorage\.setItem\(PREFERENCES_STORAGE_KEY, JSON\.stringify\(prefs\)\)/);
 assert.match(provider,/if \(loaded\)/);
 assert.match(provider,/accessibilityState=\{\{selected:theme===mode\}\}/);
 assert.match(provider,/accessibilityState=\{\{selected:language===code\}\}/);
 assert.match(provider,/setTheme\(mode\)/);
 assert.match(provider,/setLanguage\(code\)/);
 assert.doesNotMatch(provider,/firebase|Firestore|fetch\(|setDoc|uid|latitude|longitude/i);
});
test('theme and translations used by login, GPS, profile, map and status bar',()=>{
 for(const code of [gate,gps,profile,app]){
   assert.match(code,/usePreferences\(\)/);
   assert.match(code,/makeStyles\(c\)/);
 }
 assert.match(app,/StatusBar barStyle=\{theme === "light" \? "dark-content" : "light-content"\}/);
 assert.match(gate,/t\('googleCollision'\)|'googleCollision'/);
 assert.match(gate,/t\(message\)/);
 assert.match(gps,/t\('gpsExplanation'\)/);
 assert.match(gps,/language === 'th' \? 'th-TH' : 'en-US'/);
 assert.match(profile,/t\('profileTitle'\)/);
 assert.match(profile,/t\(message\)/);
 assert.match(app,/t\('mapShown'/);
 assert.match(app,/t\('searchPlaceholder'\)/);
 assert.doesNotMatch(provider+read('src/ui/preferencesModel.ts'),/requestForegroundPermissionsAsync|signInWithCredential|signOut\(|getFirestore/);
});
