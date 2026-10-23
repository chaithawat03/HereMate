/**
 * Dormant M2.4C Android Staging integration seam.
 * Deliberately NOT imported by App.tsx and NOT enabled by existing EAS profiles.
 * Mount ONLY after owner-approved Staging Cloud Run URL, server security review
 * and positive/negative real Staging integration tests are recorded.
 */
import React,{useMemo} from 'react';
import {AppState,Platform,Text,View} from 'react-native';
import * as Location from 'expo-location';
import {getStagingGuestAuth} from '../auth/firebaseGuest';
import {firebaseStagingIdentity} from '../config/firebaseStaging';
import {usePreferences} from '../ui/PreferencesProvider';
import {M2SharingPanel} from './M2SharingPanel';
import {M2FriendLocationPanel} from './M2FriendLocationPanel';
import {createM2StagingTransport} from './m2StagingTransport';

type Props=Readonly<{
  /** EXACT HTTPS origin from independently approved and deployed Cloud Run revision. */
  approvedCloudRunUrl:string;
  /** No caller may set true until M2.4 server + IAM + TTL security acceptance. */
  backendReviewedAndEnabled:boolean;
}>;

export function M2AndroidStagingScreens({
  approvedCloudRunUrl,backendReviewedAndEnabled
}:Props){
  const {t}=usePreferences();
  const transport=useMemo(()=>{
    // Fail closed: no iOS or Production exposure and no runtime-supplied URL
    // can activate M2 until the explicit Android-only integration is mounted.
    if(Platform.OS!=='android'||
       process.env.EXPO_PUBLIC_ENVIRONMENT!=='staging'||
       process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST!=='true'||
       !backendReviewedAndEnabled)return null;
    try {
      return createM2StagingTransport({
        approvedCloudRunUrl,
        projectId:firebaseStagingIdentity.projectId,
        currentIdentity:()=>{
          const user=getStagingGuestAuth().currentUser;
          return user?{uid:user.uid,getIdToken:()=>user.getIdToken()}:null;
        },
        isForeground:()=>AppState.currentState==='active',
        foregroundPermissionGranted:async()=>{
          if(AppState.currentState!=='active'||
             !await Location.hasServicesEnabledAsync())return false;
          const permission=await Location.getForegroundPermissionsAsync();
          return permission.granted===true;
        },
        // Existing M2 APK remains v1. A separate reviewed M3 native build
        // can opt into same-account capability-fenced publisher sessions.
        useDeviceSessions:process.env.EXPO_PUBLIC_ENABLE_M3_DEVICE_SESSIONS==='true',
        fetchImpl:fetch,
      });
    }catch{
      return null;
    }
  },[approvedCloudRunUrl,backendReviewedAndEnabled]);
  if(!transport)return <View><Text>{t('m2Unavailable')}</Text></View>;
  return <View>
    <M2SharingPanel transport={transport} backendReviewedAndEnabled={true}/>
    <M2FriendLocationPanel transport={transport} backendReviewedAndEnabled={true}/>
  </View>;
}
