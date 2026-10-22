import React, { useMemo, useState } from 'react';
import { PreferencesProvider, PreferenceControls, usePreferences } from './src/ui/PreferencesProvider';
import type { Palette } from './src/ui/preferencesModel';
import { GuestAuthGate } from './src/auth/GuestAuthGate';
import { Platform, Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { LocalLocationPanel } from './src/location/LocalLocationPanel';
import { UserProfilePanel } from './src/profile/UserProfilePanel';
import { getResponsiveLayout } from './src/ui/layout';
import { makeDemoFriends, searchableFriends, visibleMapFriends, type FriendStatus } from './src/domain/demo';

const counts = [0, 5, 30, 100, 500, 1000];
const filters: Array<'ALL' | FriendStatus> = ['ALL', 'LIVE', 'STALE', 'OFFLINE', 'SHARING_OFF'];
const colors: Record<FriendStatus, string> = { LIVE: '#29d9a8', STALE: '#ffca71', OFFLINE: '#a0b3c6', SHARING_OFF: '#79899b' };

function DemoMap() {
  const { colors: c, t } = usePreferences();
  const s = useMemo(() => makeStyles(c), [c]);
  const labels: Record<FriendStatus, string> = { LIVE: 'LIVE', STALE: t('statusStale'), OFFLINE: t('statusOffline'), SHARING_OFF: t('statusNotSharing') };
  // Map pins retain semantic marker colors; light-theme text labels need deeper accessible contrast.
  const statusText:Record<FriendStatus,string> = c.background === '#F7FAFC'
    ? {LIVE:c.positive,STALE:'#845400',OFFLINE:'#4F6579',SHARING_OFF:c.muted}
    : colors;
  const { width, height } = useWindowDimensions();
  const { isExpanded, mapHeight } = getResponsiveLayout(width, height);
  const [count, setCount] = useState(30);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | FriendStatus>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(true);
  const localGpsEnabled = process.env.EXPO_PUBLIC_ENVIRONMENT === 'staging' &&
    process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST === 'true' &&
    process.env.EXPO_PUBLIC_ENABLE_LOCAL_GPS === 'true';
  const m1ProfileEnabled = localGpsEnabled && process.env.EXPO_PUBLIC_ENABLE_M1_PROFILE === 'true';
  const friends = useMemo(() => makeDemoFriends(count), [count]);
  const filtered = useMemo(() => searchableFriends(friends, search, filter), [friends, search, filter]);
  const markers = useMemo(() => visibleMapFriends(friends, true).slice(0, 12), [friends]);
  const selected = friends.find(f => f.id === selectedId);
  const live = friends.filter(f => f.status === 'LIVE').length;

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={[s.page, isExpanded && s.expandedPage]} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <View><Text style={s.brand}>Here<Text style={s.accent}>Mate</Text></Text><Text style={s.sub}>{t('tagline')}</Text></View>
          <Text style={s.demo}>{t(localGpsEnabled ? 'localBadge' : 'demoBadge')}</Text>
        </View>
        <View style={s.header}><View><Text style={s.title}>{t('myMap')}</Text><Text style={s.sub}>{t(localGpsEnabled ? 'mockFriends' : 'demoMap')}</Text></View><Text style={s.live}>{live} LIVE</Text></View>
        <View style={[s.map, { height: mapHeight }]} accessibilityLabel={t("mapAccessibility")}>
          <View style={[s.road, { top: 70, left: -60, transform: [{ rotate: '25deg' }] }]} />
          <View style={[s.road, { top: 160, left: -30, transform: [{ rotate: '-35deg' }] }]} />
          <Text style={s.mapLabel}>{t('mapLabel')}</Text>
          {markers.map(friend => (
            <Pressable key={friend.id} accessibilityRole="button" accessibilityLabel={t('selectFriend',{name:friend.name})}
              onPress={() => setSelectedId(friend.id)}
              style={[s.pin, { left: `${friend.x}%`, top: `${friend.y}%`, backgroundColor: colors[friend.status] }]}>
              <Text style={s.pinText}>{friend.name[0]}</Text>
            </Pressable>
          ))}
          <View style={s.you}><Text style={s.youText}>{t('you')}</Text></View>
          <Text style={s.mapFooter}>{t('mapShown',{shown:markers.length,total:visibleMapFriends(friends,true).length})}</Text>
        </View>
        {selected ? <View style={s.info}><View style={s.flex}>
          <Text style={s.bold}>{selected.name} · {labels[selected.status]}</Text>
          <Text style={s.sub}>{selected.username} · {t('lastGps')}: {selected.lastGpsSeconds === null ? t('noData') : t('seconds',{value:selected.lastGpsSeconds})}</Text>
        </View><Pressable onPress={() => setSelectedId(null)}><Text style={s.accent}>{t('close')}</Text></Pressable></View> : null}
        {localGpsEnabled ? <LocalLocationPanel /> : (
          <View style={s.info}>
                    <View style={s.flex}><Text style={s.bold}>{t('mySharing')}</Text><Text style={s.sub}>{t('demoToggle')}</Text></View>
                    <Pressable accessibilityRole="switch" accessibilityState={{ checked: sharing }}
                      style={[s.toggle, sharing && s.enabled]} onPress={() => setSharing(!sharing)}>
                      <Text style={[s.bold,sharing&&{color:c.accentOn}]}>{t(sharing ? 'on' : 'off')}</Text>
                    </Pressable>
                  </View>
        )}
        {m1ProfileEnabled ? <UserProfilePanel /> : null}
        <View style={s.header}><Text style={s.title}>{t(m1ProfileEnabled ? 'demoFriendsTitle' : 'allFriends')}</Text><Text style={s.accent}>{t('people',{count:friends.length})}</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {counts.map(n => <Pressable key={n} style={[s.chip, n === count && s.chipOn]} onPress={() => { setCount(n); setSelectedId(null); }}><Text style={[s.chipText,n === count&&{color:c.accentOn}]}>{n}</Text></Pressable>)}
        </ScrollView>
        <TextInput value={search} onChangeText={setSearch} placeholder={t("searchPlaceholder")}
          placeholderTextColor={c.placeholder} autoCapitalize="none" accessibilityLabel={t("searchFriends")} style={s.search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {filters.map(f => <Pressable key={f} style={[s.chip, f === filter && s.chipOn]} onPress={() => setFilter(f)}><Text style={[s.chipText,f === filter&&{color:c.accentOn}]}>{f === 'ALL' ? t('all') : labels[f]}</Text></Pressable>)}
        </ScrollView>
        <View style={[s.friendList, isExpanded && s.friendGrid]}>
        {filtered.slice(0, 12).map(f => <Pressable key={f.id} style={[s.friend, isExpanded && s.friendWide]} onPress={() => setSelectedId(f.id)}>
          <View style={[s.avatar, { borderColor: colors[f.status] }]}><Text style={s.bold}>{f.name[0]}</Text></View>
          <View style={s.flex}><Text style={s.bold}>{f.name}</Text><Text style={s.sub}>{f.username}</Text></View>
          <Text style={{ color: statusText[f.status], fontSize: 11, fontWeight: '700' }}>{labels[f.status]}</Text>
        </Pressable>)}
        </View>
        {filtered.length === 0 ? <Text style={s.sub}>{t('noFriends')}</Text> : null}
        {filtered.length > 12 ? <Text style={s.foot}>{t('manyFriends',{count:filtered.length})}</Text> : null}
        <Text style={s.foot}>{t(localGpsEnabled ? 'footerLocal' : 'footerDemo')}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  page: { padding: 18, paddingBottom: 56, gap: 15, width: '100%' },
  expandedPage: { maxWidth: 960, alignSelf: 'center', paddingHorizontal: 28 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  brand: { fontSize: 27, fontWeight: '800', color: c.text },
  accent: { color: c.accent, fontWeight: '700' },
  sub: { color: c.muted, fontSize: 13, marginTop: 3 },
  demo: { color: c.positive, borderColor: c.line, borderWidth: 1, padding: 8, borderRadius: 10, fontSize: 10, fontWeight: '800' },
  title: { color: c.text, fontSize: 18, fontWeight: '800' },
  live: { backgroundColor: c.accentSoft, padding: 9, borderRadius: 16, color: c.positive, fontWeight: '800', fontSize: 12 },
  map: { backgroundColor: c.map, borderColor: c.line, borderWidth: 1, borderRadius: 20, overflow: 'hidden' },
  road: { position: 'absolute', backgroundColor: c.road, height: 12, width: '140%', borderRadius: 12 },
  mapLabel: { position: 'absolute', top: 13, left: 12, color: c.muted, backgroundColor: c.mapLabel, fontSize: 10, padding: 6, borderRadius: 6 },
  pin: { position: 'absolute', width: 24, height: 24, borderRadius: 13, borderColor: c.markerBorder, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  pinText: { color: c.pinText, fontSize: 11, fontWeight: '800' },
  you: { position: 'absolute', left: '50%', top: '50%', backgroundColor: c.you, borderColor: c.youBorder, borderWidth: 2, padding: 8, borderRadius: 18 },
  youText: { color: c.youText, fontWeight: '800' },
  mapFooter: { position: 'absolute', bottom: 10, left: 12, color: c.text, fontSize: 10, backgroundColor: c.mapLabel, padding: 7, borderRadius: 7 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, padding: 14, borderRadius: 15 },
  flex: { flex: 1 }, bold: { color: c.text, fontSize: 13, fontWeight: '700' },
  toggle: { backgroundColor: c.toggleOff, paddingVertical: 10, paddingHorizontal: 15, borderRadius: 16 },
  enabled: { backgroundColor: c.accent },
  chips: { gap: 8 },
  chip: { backgroundColor: c.chip, borderColor: c.line, borderWidth: 1, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 20 },
  chipOn: { backgroundColor: c.accent, borderColor: c.accent },
  chipText: { color: c.text, fontWeight: '700', fontSize: 12 },
  search: { backgroundColor: c.chip, borderColor: c.line, borderWidth: 1, borderRadius: 12, color: c.text, paddingHorizontal: 14, paddingVertical: 12 },
  friendList: { gap: 9 },
  friendGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  friendWide: { width: '49%' },
  friend: { flexDirection: 'row', gap: 11, borderRadius: 12, borderColor: c.line, borderWidth: 1, padding: 12, alignItems: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceAlt, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  foot: { color: c.muted, fontSize: 12, textAlign: 'center', marginTop: 9 },
});

/**
 * Explicit Staging guest login preview. Old demo remains the default and
 * unchanged on all existing production-less Android/iOS EAS profiles.
 */
function AppScreen() {
  // Android edge-to-edge windows can draw underneath the status bar. The legacy
  // RN SafeAreaView alone does not reserve that area on Android.
  // Apply the top inset ONCE at the root, for both Guest and Demo screens.
  const { colors: c, theme } = usePreferences();
  const androidTopInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;
  const guestEnabled = process.env.EXPO_PUBLIC_ENVIRONMENT === 'staging' &&
    process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST === 'true';

  return (
    <SafeAreaView style={{flex:1,backgroundColor:c.background,paddingTop:androidTopInset}}>
      <StatusBar barStyle={theme === "light" ? "dark-content" : "light-content"} backgroundColor={c.background} />
      <PreferenceControls />
      {guestEnabled ? <GuestAuthGate><DemoMap /></GuestAuthGate> : <DemoMap />}
    </SafeAreaView>
  );
}

export default function App() { return <PreferencesProvider><AppScreen /></PreferencesProvider>; }
