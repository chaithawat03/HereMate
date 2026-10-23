/**
 * M3 iOS Staging opt-in foreground experience.
 * Own Firebase Guest account, actual M1 relations, and M2 Cloud Run-backed
 * opt-in sharing only. Not a physical iPhone release or background tracking.
 */
import React from 'react';
import {SafeAreaView,ScrollView,StatusBar,Text,View,useWindowDimensions} from 'react-native';
import {PreferencesProvider,PreferenceControls,usePreferences} from './src/ui/PreferencesProvider';
import {GuestAuthGate} from './src/auth/GuestAuthGate';
import {UserProfilePanel} from './src/profile/UserProfilePanel';
import {FriendsPanel} from './src/friends/FriendsPanel';
import {M3IOSStagingScreens} from './src/location/M3IOSStagingScreens';

export const M3_IOS_STAGING_ORIGIN=
  'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app' as const;

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
        <M3IOSStagingScreens approvedCloudRunUrl={M3_IOS_STAGING_ORIGIN}
          backendReviewedAndEnabled={true}/>
      </ScrollView>
    </GuestAuthGate>
  </SafeAreaView>;
}
export default function M3IOSStagingApp(){
  return <PreferencesProvider><Content/></PreferencesProvider>;
}
