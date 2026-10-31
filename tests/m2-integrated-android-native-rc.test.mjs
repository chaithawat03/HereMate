import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ownerPaused} from './helpers-workflow-pause.mjs';
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
 assert.match(index,/m2AndroidStaging[\s\S]*?\? M2StagingApp/);
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

test('native Android release build is ONE owner-gated APK, without EAS usage or app secrets',()=>{
 assert.match(workflow,/^  workflow_dispatch:/m);
 // Paused by owner: the Issue #43 comment hook is removed; job guards below still apply.
 if(!ownerPaused(workflow)){
   assert.match(workflow,/^  issue_comment:/m);
   assert.match(workflow,/^    types: \[created\]/m);
 }
 assert.doesNotMatch(workflow,/^  push:|^  schedule:|^  pull_request:|^  pull_request_target:/m);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/inputs\.confirm_target == 'heremate\/android-m2-staging'/);
 // Exactly one Issue #43 owner comment can start a job. Others are skipped.
 assert.match(workflow,/github\.event_name == 'issue_comment'/);
 assert.match(workflow,/github\.event\.action == 'created'/);
 assert.match(workflow,/github\.event\.issue\.number == 43/);
 assert.match(workflow,/github\.event\.issue\.pull_request == null/);
 assert.match(workflow,/github\.event\.comment\.body == '\/heremate-build-m2-staging'/);
 assert.match(workflow,/github\.event\.comment\.user\.login == 'chaithawat03'/);
 assert.match(workflow,/github\.event\.comment\.user\.id == 29879036/);
 assert.match(workflow,/github\.event\.comment\.author_association == 'OWNER'/);
 assert.match(workflow,/github\.event\.sender\.login == 'chaithawat03'/);
 assert.match(workflow,/github\.actor == 'chaithawat03'/);
 assert.match(workflow,/^permissions:\n  contents: read/m);
 assert.match(workflow,/concurrency:[\s\S]*?cancel-in-progress: false/);
 assert.match(workflow,/EXPO_PUBLIC_ENABLE_M2_SHARING: 'true'/);
 assert.match(workflow,/EXPO_PUBLIC_ENABLE_FIREBASE_GUEST: 'true'/);
 assert.match(workflow,/expo prebuild --platform android --non-interactive --clean/);
 assert.match(workflow,/assembleRelease/);
 assert.match(workflow,/index\.android\.bundle/);
 assert.match(workflow,/apkSha256/);
 assert.match(workflow,/actions\/upload-artifact@v4/);
 assert.doesNotMatch(workflow,/\beas build\b|EXPO_TOKEN|id-token: write|gcloud run deploy|firebase deploy|GOOGLE_DRIVE_REFRESH_TOKEN|secrets\./);
});
