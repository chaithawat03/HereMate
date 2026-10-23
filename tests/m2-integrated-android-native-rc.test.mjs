import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const workflow=read('.github/workflows/android-m2-native-staging-apk.yml');
const index=read('index.ts');
const trial=read('M2StagingApp.tsx');
const old=read('.github/workflows/staging-eas-build.yml');
const eas=JSON.parse(read('eas.json'));

test('M2 root is opt-in Android Staging; original EAS/Demo flows unchanged',()=>{
 assert.match(index,/Platform\.OS === 'android'/);
 assert.match(index,/process\.env\.EXPO_PUBLIC_ENVIRONMENT === 'staging'/);
 assert.match(index,/process\.env\.EXPO_PUBLIC_ENABLE_M2_SHARING === 'true'/);
 assert.match(index,/m2AndroidStaging \? M2StagingApp : App/);
 assert.match(trial,/M2AndroidStagingScreens/);
 assert.match(trial,/backendReviewedAndEnabled=\{true\}/);
 assert.match(trial,/UserProfilePanel/);
 assert.match(trial,/FriendsPanel/);
 assert.match(trial,/GuestAuthGate/);
 assert.match(trial,/https:\/\/heremate-m2-location-staging-2inhowyo2a-as\.a\.run\.app/);
 assert.doesNotMatch(trial,/makeDemoFriends|requestBackgroundPermissionsAsync|startLocationUpdatesAsync/);
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M2_SHARING,undefined);
 assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_M2_SHARING,undefined);
 assert.match(old,/android-guest-staging/);
});

test('native Android release build is ONE manual APK, without EAS usage or app secrets',()=>{
 assert.match(workflow,/^  workflow_dispatch:/m);
 assert.doesNotMatch(workflow,/^  push:|^  schedule:|^  pull_request:/m);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/inputs\.confirm_target == 'heremate\/android-m2-staging'/);
 assert.match(workflow,/EXPO_PUBLIC_ENABLE_M2_SHARING: 'true'/);
 assert.match(workflow,/EXPO_PUBLIC_ENABLE_FIREBASE_GUEST: 'true'/);
 assert.match(workflow,/expo prebuild --platform android --non-interactive --clean/);
 assert.match(workflow,/assembleRelease/);
 assert.match(workflow,/index\.android\.bundle/);
 assert.match(workflow,/apkSha256/);
 assert.match(workflow,/actions\/upload-artifact@v4/);
 assert.doesNotMatch(workflow,/\beas build\b|EXPO_TOKEN|id-token: write|gcloud run deploy|firebase deploy|GOOGLE_DRIVE_REFRESH_TOKEN|secrets\./);
});
