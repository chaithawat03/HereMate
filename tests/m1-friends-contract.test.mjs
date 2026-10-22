import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkInviteCode,friendRequestId,relationView,otherParticipant} from '../src/friends/friendModel.ts';
import {translate,translations} from '../src/ui/preferencesModel.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const rules=read('firebase/firestore.rules');
const app=read('App.tsx'),client=read('src/friends/firestoreFriends.ts'),panel=read('src/friends/FriendsPanel.tsx');
const eas=JSON.parse(read('eas.json'));
const a='member00000000000001',b='member00000000000002';
const req={id:friendRequestId(a,b),senderUid:a,recipientUid:b,
  senderDisplayName:'Sender',recipientDisplayName:'Receiver',status:'pending',
  senderConsent:false,recipientConsent:false};
test('invite codes are deliberate exact UIDs; cannot invite self or search member directory',()=>{
 assert.equal(checkInviteCode(' '+a+' '),a);
 for(const bad of ['', 'test','/users/id','friend@domain.test',a+'/'])assert.throws(()=>checkInviteCode(bad));
 assert.throws(()=>friendRequestId(a,a),/CANNOT_FRIEND_SELF/);
 assert.equal(friendRequestId(a,b),a+'__'+b);
 assert.equal(relationView(req,a),'outgoing');
 assert.equal(relationView(req,b),'incoming');
 assert.deepEqual(otherParticipant(req,a),{uid:b,displayName:'Receiver'});
 assert.deepEqual(otherParticipant(req,b),{uid:a,displayName:'Sender'});
 assert.equal(relationView({...req,status:'accepted'},a),'friend');
 assert.equal(relationView({...req,status:'declined'},b),'closed');
 assert.throws(()=>relationView(req,'not-participant'));
});
test('all new translations match Thai/English and explain no GPS sharing',()=>{
 assert.deepEqual(Object.keys(translations.th).sort(),Object.keys(translations.en).sort());
 for(const lang of ['th','en']){
  for(const key of ['friendTitle','friendSend','friendRefresh','friendOwnConsent',
   'friendOtherConsent','friendRemove','friendAccept','friendDecline','friendCancel','friendNeverGps']){
    assert.ok(translate(lang,key).length>=2,key);
  }
 }
 assert.match(translate('en','friendNeverGps'),/No real GPS/);
 assert.match(translate('th','friendNeverGps'),/ไม่แชร์ GPS/);
});
test('real friend list uses only own Firebase UID; protected reads and actions',()=>{
 assert.match(client,/getStagingGuestAuth\(\)/);
 assert.match(client,/firebaseStagingIdentity\.projectId/);
 assert.match(client,/query\(base,where\('senderUid','==',uid\)\)/);
 assert.match(client,/query\(base,where\('recipientUid','==',uid\)\)/);
 assert.match(client,/friendRequestId\(uid,recipientUid\)/);
 assert.match(client,/loadOwnProfile\(\)/);
 assert.match(client,/serverTimestamp\(\)/);
 assert.match(client,/setOwnFriendConsent/);
 assert.match(client,/status:'removed',senderConsent:false,recipientConsent:false/);
 assert.doesNotMatch(client,/getDocs\(collection\(|latitude|longitude|geolocation|onSnapshot|locationUpdates|shareGPS|setInterval/);
 assert.match(panel,/selectable accessibilityLabel=\{t\('friendYourCode'\)\}/);
 assert.match(panel,/actOnRequest\(r,'accepted'\)/);
 assert.match(panel,/actOnRequest\(r,'declined'\)/);
 assert.match(panel,/actOnRequest\(r,'cancelled'\)/);
 assert.match(panel,/actOnRequest\(r,'removed'\)/);
 assert.match(panel,/setOwnFriendConsent\(r,!ownConsent\)/);
 assert.doesNotMatch(panel,/Contacts|requestForegroundPermissionsAsync|GoogleSignin\.signIn/);
});
test('Firestore ACL limits direct gets/queries to participants and immutable actor transitions',()=>{
 assert.match(rules,/match \/friendRequests\/\{pairId\}/);
 assert.match(rules,/allow get, list: if participant\(resource\.data\)/);
 assert.match(rules,/request\.auth\.uid == request\.resource\.data\.senderUid/);
 assert.match(rules,/get\(profilePath\(request\.resource\.data\.senderUid\)\)\.data\.displayName/);
 assert.match(rules,/data\.senderConsent == false/);
 assert.match(rules,/data\.recipientConsent == false/);
 assert.match(rules,/function updateOwnConsent\(/);
 assert.match(rules,/function removeAccepted\(/);
 assert.match(rules,/data\.status == 'removed'/);
 assert.match(rules,/allow delete: if false/);
 assert.match(rules,/match \/\{document=\*\*\}/);
 assert.match(rules,/allow read, write: if false/);
});
test('friend UI only enabled on Android Guest staging; demo/iOS remain unchanged',()=>{
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M1_FRIENDS,'true');
 assert.equal(eas.build['android-preview'].env.EXPO_PUBLIC_ENABLE_M1_FRIENDS,undefined);
 assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_M1_FRIENDS,undefined);
 assert.match(app,/EXPO_PUBLIC_ENABLE_M1_FRIENDS === 'true'/);
 assert.match(app,/m1FriendsEnabled \? <FriendsPanel \/>/);
 assert.match(read('docs/M1_FRIENDS_RELEASE_PLAN.md'),/manual Staging Firestore Rules deployment/);
});
