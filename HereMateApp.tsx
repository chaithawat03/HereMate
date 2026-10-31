import React from 'react';
import { StatusBar, View } from 'react-native';
import { HereMap } from './src/map/HereMap';

// HereMate v2 root (Android preview). Task 1: map-only spike; the shell,
// Demo/Live modes and screens are added by later tasks of the v2 plan.
export default function HereMateApp() {
  return (
    <View style={{ flex: 1, backgroundColor: '#EEF1F4' }}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <HereMap theme="light" center={{ lat: 13.7462, lng: 100.5347 }} />
    </View>
  );
}
