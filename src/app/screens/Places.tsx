import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useHereMate } from '../../data/ModeProvider';
import type { Capabilities, Friend, FriendPoint, LatLng, Zone, ZoneAlert } from '../../data/types';
import { ageLabel } from '../../map/status';
import { useV2 } from '../i18n';
import { RADIUS } from '../theme';
import { Avatar, ComingSoon, PrimaryButton } from '../components/Controls';
import { Icon } from '../components/Icon';
import { clampRadius, RADIUS_DEFAULT_M, RADIUS_MAX_M, RADIUS_MIN_M, RADIUS_STEP_M } from './placeRules';

type SheetProps = {
  caps: Capabilities;
  zones: Zone[];
  alerts: ZoneAlert[];
  friends: Friend[];
  now: number;
  onAdd: () => void;
  onToast: (m: string) => void;
};

export function PlacesSheet({ caps, zones, alerts, friends, now, onAdd, onToast }: SheetProps) {
  const { t, c, lang } = useV2();
  const { source } = useHereMate();
  const name = (id: string) => friends.find(f => f.id === id)?.name ?? '…';
  const zoneName = (id: string) => zones.find(z => z.id === id)?.label ?? '';

  async function decide(id: string, approve: boolean) {
    try { await source.places.decide(id, approve); } catch { onToast(t('errorGeneric')); }
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 32 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={{ fontSize: 20, fontWeight: '600', color: c.ink }}>{t('places')}</Text>
        {caps.geofences ? (
          <Pressable accessibilityRole="button" onPress={onAdd} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Icon name="plus" color={c.accent} size={16} />
            <Text style={{ color: c.accent, fontSize: 15, marginLeft: 4 }}>{t('add')}</Text>
          </Pressable>
        ) : null}
      </View>

      {!caps.geofences ? <ComingSoon /> : (
        <>
          {zones.map(z => (
            <View key={z.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomColor: c.divider, borderBottomWidth: 0.5 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: z.state === 'active' ? 'rgba(47,124,246,0.12)' : c.tile, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="places" color={z.state === 'active' ? c.accent : c.secondary} size={18} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text numberOfLines={1} style={{ fontSize: 16, color: c.ink }}>{z.label}</Text>
                <Text numberOfLines={1} style={{ fontSize: 12, color: c.secondary }}>
                  {z.state === 'active'
                    ? `${t('alertFor', { name: name(z.subjectId) })} · ${t('radius', { meters: z.radiusM })}`
                    : t('waitingFor', { name: name(z.subjectId) })}
                </Text>
              </View>
              {z.state === 'pending' && source.mode === 'demo' ? (
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable accessibilityRole="button" onPress={() => decide(z.id, false)} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                    <Text style={{ color: c.secondary, fontSize: 13 }}>{t('reject')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => decide(z.id, true)} style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: c.accent, borderRadius: RADIUS.pill }}>
                    <Text style={{ color: c.onAccent, fontSize: 13 }}>{t('approve')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}

          <Text style={{ fontSize: 13, color: c.secondary, marginTop: 16, marginBottom: 6 }}>{t('latestAlerts')}</Text>
          {alerts.length === 0 ? <Text style={{ fontSize: 14, color: c.secondary }}>{t('noAlerts')}</Text> : null}
          {alerts.slice(0, 5).map(a => (
            <View key={a.zoneId + a.atMs + a.kind} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.tile, borderRadius: RADIUS.tile, padding: 10, marginBottom: 6 }}>
              <Icon name="bell" color={c.accent} size={16} />
              <Text numberOfLines={1} style={{ flex: 1, marginLeft: 8, fontSize: 14, color: c.ink }}>
                {t(a.kind === 'enter' ? 'alertEnter' : 'alertExit', { name: name(a.friendId), place: zoneName(a.zoneId) })}
              </Text>
              <Text style={{ fontSize: 12, color: c.secondary }}>{ageLabel(now - a.atMs, lang)}</Text>
            </View>
          ))}
        </>
      )}

      <View style={{ flexDirection: 'row', marginTop: 16 }}>
        <Icon name="lock" color={c.secondary} size={14} />
        <Text style={{ flex: 1, marginLeft: 6, fontSize: 12, color: c.secondary, lineHeight: 17 }}>{t('placesPrivacyNote')}</Text>
      </View>
    </ScrollView>
  );
}

/** Propose a new place for a friend; the friend must approve before any alert. */
export function NewPlace({ friends, points, me, initialFriendId, onPreview, onDone, onCancel }: {
  friends: Friend[]; points: FriendPoint[]; me: LatLng | null; initialFriendId?: string;
  onPreview: (z: Zone | null) => void; onDone: (message: string) => void; onCancel: () => void;
}) {
  const { t, c } = useV2();
  const { source } = useHereMate();
  const eligible = useMemo(() => friends.filter(f => f.consentMine && f.consentTheirs), [friends]);
  const [friendId, setFriendId] = useState<string | null>(initialFriendId ?? eligible[0]?.id ?? null);
  const [radius, setRadius] = useState(RADIUS_DEFAULT_M);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const center: LatLng | null = points.find(p => p.friendId === friendId)?.at ?? me;
  const friend = friends.find(f => f.id === friendId);

  React.useEffect(() => {
    onPreview(center && friendId ? { id: 'preview', subjectId: friendId, label, center, radiusM: radius, state: 'pending' } : null);
    return () => onPreview(null);
  }, [center?.lat, center?.lng, friendId, radius, label]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!friendId || !center) return;
    setBusy(true);
    try {
      await source.places.propose(friendId, center, radius, label.trim() || t('placeNamePlaceholder'));
      onDone(t('waitingFor', { name: friend?.name ?? '' }));
    } catch { onDone(t('errorGeneric')); } finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ flex: 1, fontSize: 20, fontWeight: '600', color: c.ink }}>{t('newPlace')}</Text>
        <Pressable accessibilityRole="button" onPress={onCancel}><Text style={{ color: c.secondary, fontSize: 15 }}>{t('cancel')}</Text></Pressable>
      </View>
      <Text style={{ fontSize: 13, color: c.secondary, marginBottom: 6 }}>{t('chooseFriend')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
        {eligible.map(f => (
          <Pressable key={f.id} accessibilityRole="button" accessibilityState={{ selected: f.id === friendId }} onPress={() => setFriendId(f.id)}
            style={{ alignItems: 'center', marginRight: 12, opacity: f.id === friendId ? 1 : 0.5 }}>
            <Avatar id={f.id} initials={f.initials} size={44} ring={f.id === friendId ? c.accent : undefined} />
            <Text numberOfLines={1} style={{ fontSize: 12, color: c.ink, marginTop: 4, maxWidth: 64 }}>{f.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Text style={{ fontSize: 13, color: c.secondary, marginBottom: 6 }}>{t('placeName')}</Text>
      <TextInput value={label} onChangeText={setLabel} placeholder={t('placeNamePlaceholder')} placeholderTextColor={c.secondary}
        style={{ backgroundColor: c.tile, borderRadius: RADIUS.tile, paddingHorizontal: 12, paddingVertical: 10, color: c.ink, fontSize: 16, marginBottom: 14 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <Text style={{ flex: 1, fontSize: 15, color: c.ink }}>{t('radius', { meters: radius })}</Text>
        {[-RADIUS_STEP_M, RADIUS_STEP_M].map(d => (
          <Pressable key={d} accessibilityRole="button" accessibilityLabel={d < 0 ? '-' : '+'}
            onPress={() => setRadius(r => clampRadius(r + d))}
            style={{ width: 40, height: 36, borderRadius: RADIUS.tile, backgroundColor: c.tile, alignItems: 'center', justifyContent: 'center', marginLeft: 8,
              opacity: (d < 0 && radius <= RADIUS_MIN_M) || (d > 0 && radius >= RADIUS_MAX_M) ? 0.4 : 1 }}>
            <Text style={{ fontSize: 20, color: c.ink }}>{d < 0 ? '−' : '+'}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ fontSize: 12, color: c.secondary, marginBottom: 18 }}>{t('placeCenterHint')}</Text>
      <PrimaryButton label={t('sendProposal')} onPress={send} disabled={busy || !friendId || !center} />
    </ScrollView>
  );
}
