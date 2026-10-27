/**
 * M3 iOS Staging opt-in foreground experience.
 * Own Firebase Guest account, actual M1 relations, and M2 Cloud Run-backed
 * opt-in sharing only. Not a physical iPhone release or background tracking.
 */
import React,{useCallback,useState} from 'react';
import {SafeAreaView,ScrollView,StatusBar,Text,View,useWindowDimensions} from 'react-native';
import {PreferencesProvider,PreferenceControls,usePreferences} from './src/ui/PreferencesProvider';
import {GuestAuthGate} from './src/auth/GuestAuthGate';
import {UserProfilePanel} from './src/profile/UserProfilePanel';
import {FriendsPanel} from './src/friends/FriendsPanel';
import {M3IOSStagingScreens} from './src/location/M3IOSStagingScreens';
import {M4GeofenceStagingScreens} from './src/geofences/M4GeofenceStagingScreens';

export const M3_IOS_STAGING_ORIGIN=
  'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app' as const;

// This component is mounted only inside GuestAuthGate. The callback is a
// read-only reference to the current M3 transport, never a stored token.
type PublisherProvider=(actorUid:string,peerUid:string)=>string|null;
function StagingServices(){
  const [publisherProvider,setPublisherProvider]=useState<PublisherProvider|null>(null);
  const onPublisherProviderChange=useCallback((provider:PublisherProvider|null)=>{
    // Do not let React invoke the token-provider function as a state updater.
    setPublisherProvider(()=>provider);
  },[]);
  return <>
    <M3IOSStagingScreens approvedCloudRunUrl={M3_IOS_STAGING_ORIGIN}
      backendReviewedAndEnabled={true}
      onPublisherProviderChange={
        process.env.EXPO_PUBLIC_ENABLE_M4_GEOFENCES==='true'?
          onPublisherProviderChange:undefined}/>
    {process.env.EXPO_PUBLIC_ENABLE_M4_GEOFENCES==='true'?
      <M4GeofenceStagingScreens approvedCloudRunUrl={M3_IOS_STAGING_ORIGIN}
        backendReviewedAndEnabled={true}
        getPublisherSessionToken={publisherProvider??undefined}/>:null}
  </>;
}

function Content(){
  const {colors:c,theme,language}=usePreferences();
  const {width}=useWindowDimensions();
  return <SafeAreaView style={{flex:1,backgroundColor:c.background}}>
    <StatusBar barStyle={theme==='light'?'dark-content':'light-content'}/>
    <PreferenceControls/>
    <GuestAuthGate>
      <ScrollView keyboardShouldPersistTaps="handled"
        contentContainerStyle={{padding:16,paddingBottom:56,gap:14,
          width:'100%',maxWidth:width>=650?820:560,alignSelf:'center'}}>
        <View style={{gap:5}}>
          <Text style={{color:c.text,fontSize:25,fontWeight:'800'}}>HereMate</Text>
          <Text style={{color:c.accent,fontSize:12,fontWeight:'800'}}>iOS · M3 STAGING · FOREGROUND</Text>
          <Text style={{color:c.muted,fontSize:12}}>
            {language==='th'
             ? 'ทดสอบแชร์ตำแหน่งเฉพาะขณะเปิดแอป · ต้องยินยอมทั้งสองฝ่าย'
             : 'Foreground sharing only · Both friends must consent'}
          </Text>
        </View>
        <UserProfilePanel/>
        <FriendsPanel/>
        <StagingServices/>
      </ScrollView>
    </GuestAuthGate>
  </SafeAreaView>;
}
export default function M3IOSStagingApp(){
  return <PreferencesProvider><Content/></PreferencesProvider>;
}
