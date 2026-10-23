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

type Props=Readonly<{approvedCloudRunUrl:string;backendReviewedAndEnabled:boolean}>;

export function M4GeofenceStagingScreens({
 approvedCloudRunUrl,backendReviewedAndEnabled
}:Props){
 const {language,colors:c}=usePreferences();
 const transport=useMemo(()=>{
   if(!backendReviewedAndEnabled||
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
       fetchImpl:fetch
     });
   }catch{return null;}
 },[approvedCloudRunUrl,backendReviewedAndEnabled]);
 if(!transport)return <View>
   <Text style={{color:c.muted}}>
     {language==='th'?'Geofence ยังไม่เปิดใช้งาน':'Geofence is not enabled'}
   </Text>
 </View>;
 return <M4GeofencePanel transport={transport} backendReviewedAndEnabled={true}/>;
}
