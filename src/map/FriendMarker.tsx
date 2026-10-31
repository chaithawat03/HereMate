import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import type { FriendStatus, LatLng } from '../data/types';
import { ringColor } from './status';
import { avatarTint } from '../app/theme';

export function FriendMarker({ id, initials, at, status, selected, onPress }: {
  id: string; initials: string; at: LatLng; status: FriendStatus; selected?: boolean; onPress?: () => void;
}) {
  const tint = avatarTint(id);
  const size = selected ? 48 : 40;
  return (
    <Marker id={'friend-' + id} lngLat={[at.lng, at.lat]} anchor="center" onPress={onPress}>
      <View
        accessibilityRole="button"
        accessibilityLabel={initials}
        style={[s.pin, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg, borderColor: ringColor(status) }]}
      >
        <Text numberOfLines={1} style={[s.text, { color: tint.fg, fontSize: selected ? 15 : 13 }]}>{initials}</Text>
      </View>
    </Marker>
  );
}

export function MeMarker({ at }: { at: LatLng }) {
  return (
    <Marker id="me" lngLat={[at.lng, at.lat]} anchor="center">
      <View style={s.meHalo}><View style={s.me} /></View>
    </Marker>
  );
}

const s = StyleSheet.create({
  pin: { borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  text: { fontWeight: '600' },
  meHalo: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(47,124,246,0.18)', alignItems: 'center', justifyContent: 'center' },
  me: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#2F7CF6', borderWidth: 3, borderColor: '#FFFFFF' },
});
