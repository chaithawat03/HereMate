import React, { useMemo, useState } from 'react';
import { GuestAuthGate } from './src/auth/GuestAuthGate';
import { Pressable, SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { makeDemoFriends, searchableFriends, visibleMapFriends, type FriendStatus } from './src/domain/demo';

const counts = [0, 5, 30, 100, 500, 1000];
const filters: Array<'ALL' | FriendStatus> = ['ALL', 'LIVE', 'STALE', 'OFFLINE', 'SHARING_OFF'];
const colors: Record<FriendStatus, string> = { LIVE: '#29d9a8', STALE: '#ffca71', OFFLINE: '#a0b3c6', SHARING_OFF: '#79899b' };
const labels: Record<FriendStatus, string> = { LIVE: 'LIVE', STALE: 'GPS ไม่อัปเดต', OFFLINE: 'OFFLINE', SHARING_OFF: 'หยุดแชร์' };

function DemoMap() {
  const [count, setCount] = useState(30);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | FriendStatus>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sharing, setSharing] = useState(true);
  const friends = useMemo(() => makeDemoFriends(count), [count]);
  const filtered = useMemo(() => searchableFriends(friends, search, filter), [friends, search, filter]);
  const markers = useMemo(() => visibleMapFriends(friends, true).slice(0, 12), [friends]);
  const selected = friends.find(f => f.id === selectedId);
  const live = friends.filter(f => f.status === 'LIVE').length;

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.header}>
          <View><Text style={s.brand}>Here<Text style={s.accent}>Mate</Text></Text><Text style={s.sub}>Your People. One Map.</Text></View>
          <Text style={s.demo}>DEMO · NO GPS</Text>
        </View>
        <View style={s.header}><View><Text style={s.title}>แผนที่ของคุณ</Text><Text style={s.sub}>ตัวอย่างข้อมูล ไม่มีการติดตาม GPS จริง</Text></View><Text style={s.live}>{live} LIVE</Text></View>
        <View style={s.map} accessibilityLabel="ตัวอย่างตำแหน่งจำลอง ไม่ใช่ Google Maps">
          <View style={[s.road, { top: 70, left: -60, transform: [{ rotate: '25deg' }] }]} />
          <View style={[s.road, { top: 160, left: -30, transform: [{ rotate: '-35deg' }] }]} />
          <Text style={s.mapLabel}>SYNTHETIC MAP PREVIEW</Text>
          {markers.map(friend => (
            <Pressable key={friend.id} accessibilityRole="button" accessibilityLabel={'เลือก ' + friend.name}
              onPress={() => setSelectedId(friend.id)}
              style={[s.pin, { left: `${friend.x}%`, top: `${friend.y}%`, backgroundColor: colors[friend.status] }]}>
              <Text style={s.pinText}>{friend.name[0]}</Text>
            </Pressable>
          ))}
          <View style={s.you}><Text style={s.youText}>คุณ</Text></View>
          <Text style={s.mapFooter}>แสดง {markers.length} จาก {visibleMapFriends(friends, true).length} จุดจำลอง</Text>
        </View>
        {selected ? <View style={s.info}><View style={s.flex}>
          <Text style={s.bold}>{selected.name} · {labels[selected.status]}</Text>
          <Text style={s.sub}>{selected.username} · GPS ล่าสุด: {selected.lastGpsSeconds === null ? 'ไม่มีข้อมูล' : selected.lastGpsSeconds + ' วินาที'}</Text>
        </View><Pressable onPress={() => setSelectedId(null)}><Text style={s.accent}>ปิด</Text></Pressable></View> : null}
        <View style={s.info}>
          <View style={s.flex}><Text style={s.bold}>แชร์ตำแหน่งของฉัน</Text><Text style={s.sub}>ปุ่มจำลอง · ไม่มีการส่งตำแหน่งจริง</Text></View>
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: sharing }}
            style={[s.toggle, sharing && s.enabled]} onPress={() => setSharing(!sharing)}>
            <Text style={s.bold}>{sharing ? 'เปิด' : 'ปิด'}</Text>
          </Pressable>
        </View>
        <View style={s.header}><Text style={s.title}>เพื่อนทั้งหมด</Text><Text style={s.accent}>{friends.length} คน</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {counts.map(n => <Pressable key={n} style={[s.chip, n === count && s.chipOn]} onPress={() => { setCount(n); setSelectedId(null); }}><Text style={s.chipText}>{n}</Text></Pressable>)}
        </ScrollView>
        <TextInput value={search} onChangeText={setSearch} placeholder="ค้นหาชื่อหรือ @username"
          placeholderTextColor="#8ca5b8" autoCapitalize="none" accessibilityLabel="ค้นหาเพื่อน" style={s.search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {filters.map(f => <Pressable key={f} style={[s.chip, f === filter && s.chipOn]} onPress={() => setFilter(f)}><Text style={s.chipText}>{f === 'ALL' ? 'ทั้งหมด' : labels[f]}</Text></Pressable>)}
        </ScrollView>
        {filtered.slice(0, 12).map(f => <Pressable key={f.id} style={s.friend} onPress={() => setSelectedId(f.id)}>
          <View style={[s.avatar, { borderColor: colors[f.status] }]}><Text style={s.bold}>{f.name[0]}</Text></View>
          <View style={s.flex}><Text style={s.bold}>{f.name}</Text><Text style={s.sub}>{f.username}</Text></View>
          <Text style={{ color: colors[f.status], fontSize: 11, fontWeight: '700' }}>{labels[f.status]}</Text>
        </Pressable>)}
        {filtered.length === 0 ? <Text style={s.sub}>ไม่พบเพื่อน</Text> : null}
        {filtered.length > 12 ? <Text style={s.foot}>แสดง 12 จาก {filtered.length} คน · รายชื่อจริงจะใช้ Pagination</Text> : null}
        <Text style={s.foot}>HereMate M0.1 · Android Hero / iOS Ready · ไม่มีข้อมูลตำแหน่งจริง</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#071725' },
  page: { padding: 18, paddingBottom: 48, gap: 15 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  brand: { fontSize: 27, fontWeight: '800', color: '#f5f9fc' },
  accent: { color: '#50e2bb', fontWeight: '700' },
  sub: { color: '#9bb0bf', fontSize: 11, marginTop: 3 },
  demo: { color: '#6be5c1', borderColor: '#295363', borderWidth: 1, padding: 8, borderRadius: 10, fontSize: 10, fontWeight: '800' },
  title: { color: '#f0f5f8', fontSize: 18, fontWeight: '800' },
  live: { backgroundColor: '#15493d', padding: 9, borderRadius: 16, color: '#66e8bb', fontWeight: '800', fontSize: 12 },
  map: { backgroundColor: '#113342', borderColor: '#2d5767', borderWidth: 1, borderRadius: 20, height: 290, overflow: 'hidden' },
  road: { position: 'absolute', backgroundColor: '#355a66', height: 12, width: '140%', borderRadius: 12 },
  mapLabel: { position: 'absolute', top: 13, left: 12, color: '#b7d8d9', backgroundColor: '#0b2436', fontSize: 10, padding: 6, borderRadius: 6 },
  pin: { position: 'absolute', width: 24, height: 24, borderRadius: 13, borderColor: '#052232', borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  pinText: { color: '#082537', fontSize: 11, fontWeight: '800' },
  you: { position: 'absolute', left: '50%', top: '50%', backgroundColor: '#2765ed', borderColor: '#bdd2ff', borderWidth: 2, padding: 8, borderRadius: 18 },
  youText: { color: 'white', fontWeight: '800' },
  mapFooter: { position: 'absolute', bottom: 10, left: 12, color: '#d1e6e9', fontSize: 10, backgroundColor: '#0b2436', padding: 7, borderRadius: 7 },
  info: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#132b3b', padding: 14, borderRadius: 15 },
  flex: { flex: 1 }, bold: { color: '#eff5f8', fontSize: 13, fontWeight: '700' },
  toggle: { backgroundColor: '#44586a', paddingVertical: 10, paddingHorizontal: 15, borderRadius: 16 },
  enabled: { backgroundColor: '#14785c' },
  chips: { gap: 8 },
  chip: { backgroundColor: '#173040', borderColor: '#355161', borderWidth: 1, paddingVertical: 9, paddingHorizontal: 13, borderRadius: 20 },
  chipOn: { backgroundColor: '#1f8067', borderColor: '#5ac9ad' },
  chipText: { color: '#e7f5f3', fontWeight: '700', fontSize: 12 },
  search: { backgroundColor: '#173040', borderColor: '#355161', borderWidth: 1, borderRadius: 12, color: 'white', paddingHorizontal: 14, paddingVertical: 12 },
  friend: { flexDirection: 'row', gap: 11, borderRadius: 12, borderColor: '#284050', borderWidth: 1, padding: 12, alignItems: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#264659', borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  foot: { color: '#91aabb', fontSize: 11, textAlign: 'center', marginTop: 9 },
});

/**
 * Explicit Staging guest login preview. Old demo remains the default and
 * unchanged on all existing production-less Android/iOS EAS profiles.
 */
export default function App() {
  if (process.env.EXPO_PUBLIC_ENVIRONMENT !== 'staging' ||
      process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST !== 'true') {
    return <DemoMap />;
  }
  return <GuestAuthGate><DemoMap /></GuestAuthGate>;
}
