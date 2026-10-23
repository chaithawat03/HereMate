/**
 * M3 opt-in iOS foreground-only Staging transport.
 * Same real Cloud Run Auth/consent protected M2 endpoints as Android;
 * no background TaskManager, Google iOS sign-in or Production release.
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

type Props=Readonly<{approvedCloudRunUrl:string;backendReviewedAndEnabled:boolean}>;

export function M3IOSStagingScreens({approvedCloudRunUrl,backendReviewedAndEnabled}:Props){
  const {t}=usePreferences();
  const transport=useMemo(()=>{
    // iOS must be explicitly enabled independently of the Android M2 build.
    if(Platform.OS!=='ios'||
       process.env.EXPO_PUBLIC_ENVIRONMENT!=='staging'||
       process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST!=='true'||
       process.env.EXPO_PUBLIC_ENABLE_M3_IOS_FOREGROUND!=='true'||
       !backendReviewedAndEnabled)return null;
    try{
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
          return (await Location.getForegroundPermissionsAsync()).granted===true;
        },
        // Current iOS EAS profiles never enable M3; once approved,
        // use capability-bound sessions to prevent same-account device leaks.
        useDeviceSessions:true,
        fetchImpl:fetch
      });
    }catch{return null;}
  },[approvedCloudRunUrl,backendReviewedAndEnabled]);
  if(!transport)return <View><Text>{t('m2Unavailable')}</Text></View>;
  return <View>
    <M2SharingPanel transport={transport} backendReviewedAndEnabled={true}/>
    <M2FriendLocationPanel transport={transport} backendReviewedAndEnabled={true}/>
  </View>;
}
