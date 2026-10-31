import React from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import type { Capabilities, Friend, FriendPoint, LatLng, SharingState } from '../../data/types';
import { androidGeoUri } from '../../location/androidGeoHandoff';
import { ageLabel, distanceLabel, metersBetween, ringColor } from '../../map/status';
import { useV2 } from '../i18n';
import { ActionTile, Avatar, ComingSoon } from '../components/Controls';
import { Icon } from '../components/Icon';

type Props = {
  friend: Friend;
  point: FriendPoint | undefined;
  me: LatLng | null;
  now: number;
  caps: Capabilities;
  sharing: SharingState;
  onClose: () => void;
  onShare: () => void;
  onStopSharing: () => void;
  onAlerts: () => void;
  onWave: () => void;
  onConsent: (on: boolean) => void;
  onRemove: () => void;
};

export function FriendDetail(p: Props) {
  const { t, c, lang } = useV2();
  const { friend, point } = p;
  const statusKey = point?.status === 'LIVE' ? 'statusLive' : point?.status === 'STALE' ? 'statusStale'
    : point?.status === 'OFFLINE' ? 'statusOffline' : 'statusSharingOff';
  const parts: string[] = [];
  if (point?.placeLabel) parts.push(point.placeLabel);
  if (point?.capturedAtMs != null) parts.push(t('updated', { age: ageLabel(p.now - point.capturedAtMs, lang) }));
  if (point?.at && p.me) parts.push(t('away', { distance: distanceLabel(metersBetween(p.me, point.at), lang) }));
  const sharingWithFriend = p.sharing.foregroundWith === friend.id || p.sharing.background?.withId === friend.id;
  const consentText = friend.consentMine && friend.consentTheirs ? t('bothSharing')
    : !friend.consentTheirs ? t('theyNotSharing', { name: friend.name }) : t('youNotSharing', { name: friend.name });

  function directions() {
    const uri = point?.at ? androidGeoUri(point.at.lat, point.at.lng) : null;
    if (!uri) return;
    // Coordinates leave HereMate only after explicit confirmation (androidGeoHandoff contract).
    Alert.alert(t('directions'), friend.name, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('continue'), onPress: () => { void Linking.openURL(uri); } },
    ]);
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 32 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
        <Avatar id={friend.id} initials={friend.initials} size={44} ring={point ? ringColor(point.status) : undefined} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text numberOfLines={1} style={{ fontSize: 22, fontWeight: '600', color: c.ink }}>{friend.name}</Text>
          <Text style={{ fontSize: 13, color: point ? ringColor(point.status) : c.secondary }}>{t(statusKey)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('cancel')} onPress={p.onClose}
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.tile, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" color={c.secondary} size={16} />
        </Pressable>
      </View>
      <Text numberOfLines={2} style={{ fontSize: 14, color: c.secondary, marginBottom: 14 }}>{parts.join(' · ')}</Text>

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        <ActionTile icon="route" label={t('directions')} onPress={directions} />
        <ActionTile icon="bell" label={t('alerts')} onPress={p.onAlerts} />
        {p.caps.wave ? <ActionTile icon="wave" label={t('wave')} onPress={p.onWave} /> : null}
      </View>
      {!p.caps.wave ? <View style={{ marginBottom: 14 }}><ComingSoon compact /></View> : null}

      <Pressable accessibilityRole="button" onPress={() => p.onConsent(!friend.consentMine)}
        style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopColor: c.divider, borderTopWidth: 0.5 }}>
        <Icon name="lock" color={c.secondary} size={16} />
        <Text style={{ flex: 1, marginLeft: 8, fontSize: 14, color: c.ink }}>{consentText}</Text>
        <Text style={{ fontSize: 14, color: c.accent }}>{t('manage')}</Text>
      </Pressable>

      {sharingWithFriend ? (
        <Pressable accessibilityRole="button" onPress={p.onStopSharing} style={{ paddingVertical: 12, borderTopColor: c.divider, borderTopWidth: 0.5 }}>
          <Text style={{ fontSize: 15, color: c.danger }}>{t('stopSharingWith', { name: friend.name })}</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" onPress={p.onShare} style={{ paddingVertical: 12, borderTopColor: c.divider, borderTopWidth: 0.5 }}>
          <Text style={{ fontSize: 15, color: c.accent }}>{t('shareWith', { name: friend.name })}</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={p.onRemove} style={{ paddingVertical: 12, borderTopColor: c.divider, borderTopWidth: 0.5 }}>
        <Text style={{ fontSize: 15, color: c.secondary }}>{t('removeFriend')}</Text>
      </Pressable>
    </ScrollView>
  );
}
