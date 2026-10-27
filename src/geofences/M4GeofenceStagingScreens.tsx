/**
 * M4 source-only client wiring. Not enabled by ANY committed Android/iOS EAS,
 * native APK or Production profile. The protected M4 HTTP API is not deployed.
 * Requires separate reviewed backend, privacy/TTL, flag and build gate.
 */
import React,{useMemo} from 'react';
import {AppState,Platform,Text,View} from 'react-native';
import * as Location from 'expo-location';
import {getStagingGuestAuth} from '../auth/firebaseGuest';
import {firebaseStagingIdentity} from '../config/firebaseStaging';
import {usePreferences} from '../ui/PreferencesProvider';
import {createM4StagingTransport} from './m4StagingTransport';
import {M4GeofencePanel} from './M4GeofencePanel';

type Props=Readonly<{
 approvedCloudRunUrl:string;backendReviewedAndEnabled:boolean;
 /** Inject ONLY from the authenticated M3 publisher of this same device.
  * No default capability, local storage, token logging or UID-only fallback. */
 getPublisherSessionToken?:(actorUid:string,ownerUid:string)=>string|null;
}>;

export function M4GeofenceStagingScreens({
 approvedCloudRunUrl,backendReviewedAndEnabled,getPublisherSessionToken
}:Props){
 const {language,colors:c}=usePreferences();
 const transport=useMemo(()=>{
   // M3 v2 geofence EVALUATE is bound to the exact handset publisher
   // capability. This UI currently has no approved M2->M4 token bridge.
   // Never mount a superficially working M4 panel that will silently use
   // the legacy UID-only v1 request when v2 is selected.
   const requiresV2Capability=
     process.env.EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS==='true'||
     // iOS foreground Staging opts into v2 sessions unconditionally;
     // unlike Android it has no separate DEVICE_SESSIONS flag.
     (Platform.OS==='ios'&&
      process.env.EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND==='true');
   if((requiresV2Capability&&typeof getPublisherSessionToken!=='function')||
      !backendReviewedAndEnabled||
      !['android','ios'].includes(Platform.OS)||
      process.env.EXPO_PUBLIC_ENVIRONMENT!=='staging'||
      process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST!=='true'||
      process.env.EXPO_PUBLIC_ENABLE_M4_GEOFENCES!=='true')return null;
   try{
     return createM4StagingTransport({
       approvedCloudRunUrl,
       projectId:firebaseStagingIdentity.projectId,
       currentIdentity:()=>{
         const user=getStagingGuestAuth().currentUser;
         return user?{uid:user.uid,getIdToken:()=>user.getIdToken()}:null;
       },
       isForeground:()=>AppState.currentState==='active',
       foregroundPermissionGranted:async()=>AppState.currentState==='active'&&
         await Location.hasServicesEnabledAsync()&&
         (await Location.getForegroundPermissionsAsync()).granted===true,
       ...(requiresV2Capability?{getPublisherSessionToken}:{}),
       fetchImpl:fetch
     });
   }catch{return null;}
 },[approvedCloudRunUrl,backendReviewedAndEnabled,getPublisherSessionToken]);
 if(!transport)return <View>
   <Text style={{color:c.muted}}>
     {language==='th'?'Geofence ยังไม่เปิดใช้งาน':'Geofence is not enabled'}
   </Text>
 </View>;
 return <M4GeofencePanel transport={transport} backendReviewedAndEnabled={true}/>;
}
