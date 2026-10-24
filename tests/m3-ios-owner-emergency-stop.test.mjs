import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canOfferOwnerEmergencyStop} from '../src/location/m3OwnerEmergencyStopGate.ts';
import {createM2StagingTransport} from '../src/location/m2StagingTransport.ts';
import {handleLocationHttp} from '../backend/location/http.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const OWNER='iosowner00000000001',PEER='iosfriend0000000002';
const ORIGIN='https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app';
const JWT='T'.repeat(80),CAPABILITY='a'.repeat(64);
const fix={latitude:0,longitude:0,accuracyMeters:15,capturedAtMs:Date.now()-500};

test('M3 owner emergency STOP is iOS-only with explicit foreground Staging flag; Android stays supported',()=>{
 for(const platform of ['web','windows','macos','unknown','']){
   for(const optIn of [false,true])
     assert.equal(canOfferOwnerEmergencyStop(platform,optIn,true),false);
 }
 assert.equal(canOfferOwnerEmergencyStop('ios',false,true),false,
   'iOS normal release must never acquire owner emergency controls');
 assert.equal(canOfferOwnerEmergencyStop('ios',true,true),true);
 assert.equal(canOfferOwnerEmergencyStop('ios',true,false),false,
   'control cannot be shown without authenticated server revoke transport');
 assert.equal(canOfferOwnerEmergencyStop('android',false,true),true,
   'existing M2 Android emergency STOP remains unchanged');
 assert.equal(canOfferOwnerEmergencyStop('android',true,false),false);
});

test('M3 iOS owner can revoke a lost handset v2 publisher without its capability token or GPS permission',async()=>{
 let actor=OWNER,foreground=true,permission=true;
 const requests=[];
 const api={
   async startDevice({idToken,viewerUid}){
     assert.equal(idToken,JWT);assert.equal(viewerUid,PEER);
     return {enabled:true,expiresAtMs:Date.now()+50_000,sessionToken:CAPABILITY};
   },
   async stop({idToken,viewerUid}){
     assert.equal(idToken,JWT);assert.equal(viewerUid,PEER);
     return {enabled:false};
   }
 };
 const transport=createM2StagingTransport({
   approvedCloudRunUrl:ORIGIN,projectId:'heremate',useDeviceSessions:true,
   currentIdentity:()=>actor?{uid:actor,getIdToken:async()=>JWT}:null,
   isForeground:()=>foreground,
   foregroundPermissionGranted:async()=>permission,
   fetchImpl:async(url,options)=>{
     const path=new URL(url).pathname,body=JSON.parse(options.body);
     requests.push({path,body,options});
     const response=await handleLocationHttp({
       method:options.method,path,
       contentType:options.headers['Content-Type'],
       authorization:options.headers.Authorization,bodyText:options.body
     },api);
     return {ok:response.status===200,status:response.status,
       json:async()=>response.body};
   }
 });
 assert.equal((await transport.start(PEER)).enabled,true);
 // After a lost handset, even another signed-in iPhone can issue owner-wide
 // STOP without owning the publisher capability or having location permission.
 foreground=false;permission=false;
 assert.deepEqual(await transport.emergencyStop(PEER),{enabled:false});
 assert.deepEqual(requests.map(row=>row.path),[
   '/v2/locations/sessions/start','/v1/locations/grants/stop'
 ]);
 const stopRequest=requests[1];
 assert.deepEqual(stopRequest.body,{viewerUid:PEER});
 assert.equal(stopRequest.options.headers.Authorization,'Bearer '+JWT);
 assert.equal(stopRequest.options.headers['Cache-Control'],'no-store');
 assert.equal(stopRequest.options.redirect,'error');
 assert.equal(Object.hasOwn(stopRequest.body,'sessionToken'),false,
   'owner emergency STOP never exposes device publisher capability');
 assert.equal(Object.hasOwn(stopRequest.body,'point'),false,
   'owner emergency STOP never sends GPS');
 foreground=true;permission=true;
 await assert.rejects(transport.publish(PEER,fix),/UNAVAILABLE/,
   'previous device token cannot resume publishing after confirmed STOP');
 await assert.rejects(transport.stop(PEER),/UNAVAILABLE/);
 assert.equal(requests.length,2);
 actor=null;
 await assert.rejects(transport.emergencyStop(PEER),/UNAVAILABLE/,
   'signed-out iOS device cannot revoke another user\'s grant');
 assert.equal(requests.length,2);
});

test('M3 iOS revoke UI retains server confirmation, per-friend scope and no silent opt-in',()=>{
 const screen=read('src/location/M2SharingPanel.tsx');
 const ios=read('src/location/M3IOSStagingScreens.tsx');
 const index=read('index.ts');
 const androidBuild=read('.github/workflows/android-m2-native-staging-apk.yml');
 const eas=JSON.parse(read('eas.json'));
 assert.match(screen,/canOfferOwnerEmergencyStop\(/);
 assert.match(screen,/EXPO_PUBLIC_ENVIRONMENT==='staging'/);
 assert.match(screen,/EXPO_PUBLIC_ENABLE_FIREBASE_GUEST==='true'/);
 assert.match(screen,/EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND==='true'/);
 assert.match(screen,/typeof transport\.emergencyStop==='function'/);
 assert.match(screen,/AppState\.currentState!=='active'/);
 assert.match(screen,/r\.senderUid===actor&&r\.recipientUid===peerUid/);
 assert.match(screen,/acknowledgeEmergencyStop\(peerUid\)/);
 assert.match(screen,/status:'confirmed'/);
 assert.match(screen,/status:'failed'/);
 assert.match(ios,/useDeviceSessions:true/);
 assert.match(index,/m3IOSForegroundStaging \? M3IOSStagingApp : App/);
 assert.doesNotMatch(androidBuild,/EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS/);
 assert.equal(eas.build['ios-guest-simulator'].env.EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND,undefined);
 assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS,undefined);
 assert.doesNotMatch(read('src/location/m3OwnerEmergencyStopGate.ts'),
  /TaskManager|requestBackgroundPermissionsAsync|startLocationUpdatesAsync|AsyncStorage|fetch\(/);
});
