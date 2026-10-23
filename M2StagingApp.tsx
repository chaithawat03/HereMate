/**
 * Owner-approved HereMate M2: integrated Android Staging trial only.
 *
 * One true Firebase Guest identity -> own M1 profile -> real M1 friends/dual
 * consent -> foreground-only location start/publish -> verified Cloud Run READ.
 * No synthetic friend pins, no background GPS, no iOS or Production rollout.
 *
 * This root is selected ONLY by index.ts with explicit Android Staging build
 * flags in the manual, single-APK workflow. The normal App.tsx is untouched.
 */
import React from 'react';
import {
  Platform,SafeAreaView,ScrollView,StatusBar,Text,View,useWindowDimensions
} from 'react-native';
import {PreferencesProvider,PreferenceControls,usePreferences} from './src/ui/PreferencesProvider';
import {GuestAuthGate} from './src/auth/GuestAuthGate';
import {UserProfilePanel} from './src/profile/UserProfilePanel';
import {FriendsPanel} from './src/friends/FriendsPanel';
import {M2AndroidStagingScreens} from './src/location/M2AndroidStagingScreens';
import {M4GeofenceStagingScreens} from './src/geofences/M4GeofenceStagingScreens';

// Confirmed by Cloud Run services describe in the owner-approved GCP project,
// and exercised in the successful three-account live Staging E2E.
export const HERE_M2_STAGING_ORIGIN=
  'https://heremate-m2-location-staging-2inhowyo2a-as.a.run.app' as const;

function M2Screen(){
  const {colors:c,theme,language,t}=usePreferences();
  const {width}=useWindowDimensions();
  const top=Platform.OS==='android'?(StatusBar.currentHeight??24):0;
  const enabled=Platform.OS==='android' &&
    process.env.EXPO_PUBLIC_ENVIRONMENT==='staging' &&
    process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST==='true' &&
    process.env.EXPO_PUBLIC_ENABLE_M2_SHARING==='true';
  return (
    <SafeAreaView style={{flex:1,backgroundColor:c.background,paddingTop:top}}>
      <StatusBar barStyle={theme==='light'?'dark-content':'light-content'}
        backgroundColor={c.background}/>
      <PreferenceControls/>
      {enabled ? <GuestAuthGate>
        <ScrollView keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding:16,paddingBottom:52,gap:14,
            width:'100%',maxWidth:width>=650?820:560,alignSelf:'center'
          }}>
          <View style={{gap:5}}>
            <Text style={{color:c.text,fontSize:25,fontWeight:'800'}}>HereMate</Text>
            <Text style={{color:c.accent,fontSize:12,fontWeight:'800'}}>
              ANDROID · M2 STAGING
            </Text>
            <Text style={{color:c.muted,fontSize:12,lineHeight:19}}>
              {language==='th'
                ? 'แชร์ตำแหน่งเมื่อเปิดแอปเท่านั้น · ต้องเป็นเพื่อนและยินยอมทั้งสองฝ่าย · ไม่มีการติดตามเบื้องหลัง'
                : 'Foreground sharing only · Accepted friends and mutual consent required · No background tracking'}
            </Text>
          </View>
          <UserProfilePanel/>
          <FriendsPanel/>
          <M2AndroidStagingScreens
            approvedCloudRunUrl={HERE_M2_STAGING_ORIGIN}
            backendReviewedAndEnabled={true}/>
          {process.env.EXPO_PUBLIC_ENABLE_M4_GEOFENCES==='true'?
            <M4GeofenceStagingScreens
              approvedCloudRunUrl={HERE_M2_STAGING_ORIGIN}
              backendReviewedAndEnabled={true}/>:null}
          <Text style={{fontSize:12,color:c.muted}}>{t('m2MapSchematic')}</Text>
        </ScrollView>
      </GuestAuthGate> : <View style={{padding:20}}>
        <Text style={{color:c.text}}>{t('m2Unavailable')}</Text>
      </View>}
    </SafeAreaView>
  );
}
export default function M2StagingApp(){
  return <PreferencesProvider><M2Screen/></PreferencesProvider>;
}
