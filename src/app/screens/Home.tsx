import React, { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useHereMate } from '../../data/ModeProvider';
import type { Friend, FriendPoint, LatLng, Mode, Zone } from '../../data/types';
import { HereMap } from '../../map/HereMap';
import { FriendMarker, MeMarker } from '../../map/FriendMarker';
import { ZoneCircles } from '../../map/ZoneCircle';
import { ageLabel, distanceLabel, metersBetween, ringColor } from '../../map/status';
import { useV2 } from '../i18n';
import { RADIUS } from '../theme';
import { Avatar, ModeSwitch } from '../components/Controls';
import { BottomSheet, type Snap } from '../components/BottomSheet';
import { Icon } from '../components/Icon';

const BANGKOK: LatLng = { lat: 13.7462, lng: 100.5347 };

type MapScreenProps = {
  points: FriendPoint[];
  friends: Friend[];
  connected: boolean;
  me: LatLng | null;
  zones: Zone[] | null;
  selectedId: string | null;
  focus: LatLng | null;
  onSelectFriend: (id: string) => void;
  onRetry: () => void;
  modeBusy: boolean;
  onMode: (m: Mode) => void;
  snap: Snap;
  onSnap: (s: Snap) => void;
  sheet: ReactNode;
  bottomInset: number;
};

/** Full-screen map with floating glass controls and a bottom sheet (friends, places or a friend card). */
export function MapScreen(p: MapScreenProps) {
  const { t, c, theme } = useV2();
  const { mode } = useHereMate();
  const [recenterTick, setRecenterTick] = useState(0);
  const center = p.focus ?? p.me ?? BANGKOK;
  const byId = useMemo(() => new Map(p.friends.map(f => [f.id, f])), [p.friends]);

  return (
    <View style={{ flex: 1, backgroundColor: c.mapBase }}>
      <HereMap key={recenterTick} theme={theme} center={center} zoom={p.focus ? 14.5 : 12.5}>
        {p.zones ? <ZoneCircles zones={p.zones} /> : null}
        {p.points.map(pt => {
          const f = byId.get(pt.friendId);
          return pt.at && f ? (
            <FriendMarker key={pt.friendId} id={pt.friendId} initials={f.initials} at={pt.at} status={pt.status}
              selected={p.selectedId === pt.friendId} onPress={() => p.onSelectFriend(pt.friendId)} />
          ) : null;
        })}
        {p.me ? <MeMarker at={p.me} /> : null}
      </HereMap>

      <View pointerEvents="box-none" style={{ position: 'absolute', top: 44, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.glass, borderColor: c.glassBorder, borderWidth: 0.5, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: c.ink }}>{t('appName')}</Text>
          {mode === 'demo' ? (
            <View style={{ marginLeft: 8, backgroundColor: c.stale, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#3A2A00' }}>{t('demoBadge')}</Text>
            </View>
          ) : null}
        </View>
        <ModeSwitch mode={mode} onChange={p.onMode} busy={p.modeBusy} />
      </View>

      {!p.connected ? (
        <Pressable accessibilityRole="button" onPress={p.onRetry}
          style={{ position: 'absolute', top: 92, left: 12, right: 12, backgroundColor: c.glassStrong, borderColor: c.glassBorder, borderWidth: 0.5, borderRadius: RADIUS.tile, padding: 12, flexDirection: 'row' }}>
          <Text style={{ flex: 1, color: c.ink, fontSize: 14 }}>{t('cantConnect')}</Text>
          <Text style={{ color: c.accent, fontSize: 14, fontWeight: '600' }}>{t('retry')}</Text>
        </Pressable>
      ) : null}

      <Pressable accessibilityRole="button" accessibilityLabel={t('recenter')} onPress={() => setRecenterTick(x => x + 1)}
        style={{ position: 'absolute', right: 12, top: 150, width: 40, height: 40, borderRadius: 12, backgroundColor: c.glass, borderColor: c.glassBorder, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="locate" color={c.ink} size={20} />
      </Pressable>

      <BottomSheet snap={p.snap} onSnap={p.onSnap} bottomInset={p.bottomInset}>{p.sheet}</BottomSheet>
    </View>
  );
}

type FriendsSheetProps = {
  friends: Friend[];
  points: FriendPoint[];
  me: LatLng | null;
  now: number;
  sharingWith: string | null;
  onSelect: (id: string) => void;
  onAddFriend: () => void;
  incomingCount: number;
};

/** Friends list inside the bottom sheet. */
export function FriendsSheet(p: FriendsSheetProps) {
  const { t, c, lang } = useV2();
  const [query, setQuery] = useState('');
  const pointById = useMemo(() => new Map(p.points.map(pt => [pt.friendId, pt])), [p.points]);
  const order = { LIVE: 0, STALE: 1, OFFLINE: 2, SHARING_OFF: 3 } as const;
  const rows = useMemo(() => p.friends
    .filter(f => !query.trim() || f.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => order[pointById.get(a.id)?.status ?? 'SHARING_OFF'] - order[pointById.get(b.id)?.status ?? 'SHARING_OFF']),
  [p.friends, query, pointById]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1, paddingHorizontal: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '600', color: c.ink }}>{t('friends')}</Text>
        <Text style={{ fontSize: 13, color: p.sharingWith ? c.live : c.secondary }}>
          {p.sharingWith ? '● ' + t('sharingOn') : t('sharingOff')}
        </Text>
      </View>
      {p.friends.length > 8 ? (
        <TextInput value={query} onChangeText={setQuery} placeholder={t('searchFriends')} placeholderTextColor={c.secondary}
          style={{ backgroundColor: c.tile, borderRadius: RADIUS.tile, paddingHorizontal: 12, paddingVertical: 8, color: c.ink, marginBottom: 6, fontSize: 15 }} />
      ) : null}
      {p.friends.length === 0 ? (
        <View style={{ paddingVertical: 24, alignItems: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: c.ink, textAlign: 'center' }}>{t('emptyFriendsTitle')}</Text>
          <Text style={{ fontSize: 14, color: c.secondary, textAlign: 'center', marginTop: 6, marginBottom: 14 }}>{t('emptyFriendsBody')}</Text>
          <Pressable accessibilityRole="button" onPress={p.onAddFriend} style={{ backgroundColor: c.accent, borderRadius: RADIUS.pill, paddingHorizontal: 18, paddingVertical: 10 }}>
            <Text style={{ color: c.onAccent, fontWeight: '600' }}>{t('addFriend')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={f => f.id}
          ListFooterComponent={
            <Pressable accessibilityRole="button" onPress={p.onAddFriend} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}>
              <Icon name="plus" color={c.accent} size={18} />
              <Text style={{ color: c.accent, fontSize: 15, marginLeft: 8 }}>
                {t('addFriend')}{p.incomingCount ? ` (${p.incomingCount})` : ''}
              </Text>
            </Pressable>
          }
          renderItem={({ item }) => {
            const pt = pointById.get(item.id);
            const sub: string[] = [];
            if (pt?.placeLabel) sub.push(pt.placeLabel);
            if (pt?.capturedAtMs != null) sub.push(ageLabel(p.now - pt.capturedAtMs, lang));
            if (!pt) sub.push(t('statusSharingOff'));
            const dist = pt?.at && p.me ? distanceLabel(metersBetween(p.me, pt.at), lang) : '';
            return (
              <Pressable accessibilityRole="button" onPress={() => p.onSelect(item.id)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomColor: c.divider, borderBottomWidth: 0.5 }}>
                <Avatar id={item.id} initials={item.initials} size={38} ring={pt ? ringColor(pt.status) : undefined} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text numberOfLines={1} style={{ fontSize: 16, color: c.ink }}>{item.name}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 13, color: c.secondary }}>{sub.join(' · ')}</Text>
                </View>
                {dist ? <Text style={{ fontSize: 13, color: c.secondary }}>{dist}</Text> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
