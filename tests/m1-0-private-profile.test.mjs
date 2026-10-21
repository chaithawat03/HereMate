import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeDisplayName} from '../src/profile/profileModel.ts';
const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
const client=read('src/profile/firestoreProfile.ts');
const panel=read('src/profile/UserProfilePanel.tsx');
const app=read('App.tsx');
const eas=JSON.parse(read('eas.json'));
const rules=read('firebase/firestore.rules');

test('normalize display names; do not use phone, GPS, or random UID fields',()=>{
 assert.equal(normalizeDisplayName('  สมชาย  '),'สมชาย');
 assert.equal(normalizeDisplayName('A B'),'A B');
 for(const s of ['','A','   ','x'.repeat(33),'A\nB']) assert.throws(()=>normalizeDisplayName(s));
});
test('profile storage always targets current authenticated UID on staging and never lists strangers',()=>{
 assert.match(client,/getStagingGuestAuth\(\)/);
 assert.match(client,/auth\.currentUser\?\.uid/);
 assert.match(client,/firebaseStagingIdentity\.projectId/);
 assert.match(client,/doc\(getFirestore\(app\), 'users', uid\)/);
 assert.match(client,/getDoc\(ownProfileRef\(\)\)/);
 assert.match(client,/setDoc\(ownProfileRef\(\)/);
 assert.match(client,/updateDoc\(ownProfileRef\(\)/);
 assert.match(client,/shareLocation: false/);
 assert.doesNotMatch(client,/collection\(|getDocs\(|query\(|phone|longitude|latitude|geolocation|gps|onSnapshot|deleteDoc/);
});
test('M1.0 profile is opt-in in Guest staging profile and never enabled in original demo',()=>{
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M1_PROFILE,'true');
 assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_M1_PROFILE,'true');
 assert.equal(eas.build['android-preview'].env.EXPO_PUBLIC_ENABLE_M1_PROFILE,undefined);
 assert.match(app,/EXPO_PUBLIC_ENABLE_M1_PROFILE === 'true'/);
 assert.match(app,/m1ProfileEnabled \? <UserProfilePanel \/>/);
 assert.match(app,/เพื่อนจำลอง/);
 assert.match(panel,/loadOwnProfile\(\)/);
 assert.match(panel,/createOwnProfile\(name\)/);
 assert.match(panel,/renameOwnProfile\(name\)/);
 assert.match(panel,/activeRef\.current/);
});
test('only owner profile get/create/rename; no users list, sharing or other collection access',()=>{
 assert.match(rules,/allow get: if owner\(uid\)/);
 assert.match(rules,/allow list: if false/);
 assert.match(rules,/allow create: if owner\(uid\)/);
 assert.match(rules,/allow update: if owner\(uid\)/);
 assert.match(rules,/allow delete: if false/);
 assert.match(rules,/data\.shareLocation == false/);
 assert.match(rules,/affectedKeys\(\)\.hasOnly\(\['displayName', 'updatedAt'\]\)/);
 assert.match(rules,/allow read, write: if false;/);
});
test('private profile does not claim deployed firestore and no production release',()=>{
 assert.match(read('docs/M1_0_PRIVATE_PROFILE_FOUNDATION.md'),/does not deploy Firestore Rules/);
 assert.equal(Object.hasOwn(eas.build,'production'),false);
});
