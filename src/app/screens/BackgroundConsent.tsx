import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useHereMate } from '../../data/ModeProvider';
import { BACKGROUND_HOURS, type BackgroundHours, type Friend } from '../../data/types';
import { useV2 } from '../i18n';
import { RADIUS } from '../theme';
import { Avatar, PrimaryButton } from '../components/Controls';
import { Icon, type IconName } from '../components/Icon';

/** Explicit, time-boxed consent for closed-app sharing with ONE friend. */
export function BackgroundConsent({ friend, onDone, onCancel, onPermissionDenied }: {
  friend: Friend;
  onDone: (message: string) => void;
  onCancel: () => void;
  onPermissionDenied: () => void;
}) {
  const { t, c } = useV2();
  const { source } = useHereMate();
  const [hours, setHours] = useState<BackgroundHours>(1);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      await source.location.startBackground(friend.id, hours);
      onDone(t('sharingOn'));
    } catch (e) {
      if (e instanceof Error && e.message === 'BACKGROUND_PERMISSION_DENIED') onPermissionDenied();
      else onDone(t('errorGeneric'));
    } finally { setBusy(false); }
  }

  const point = (icon: IconName, text: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
      <View style={{ marginTop: 1 }}><Icon name={icon} color={c.accent} size={18} /></View>
      <Text style={{ flex: 1, marginLeft: 10, fontSize: 15, color: c.ink, lineHeight: 21 }}>{text}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 90, paddingBottom: 24 }}>
        <Avatar id={friend.id} initials={friend.initials} size={56} />
        <Text style={{ fontSize: 23, fontWeight: '600', color: c.ink, marginTop: 16, marginBottom: 18 }}>
          {t('bgConsentTitle', { name: friend.name })}
        </Text>
        {point('friends', t('bgConsentWhat', { name: friend.name }))}
        {point('bell', t('bgConsentNotification'))}
        {point('lock', t('bgConsentBattery'))}
        <Text style={{ fontSize: 13, color: c.secondary, marginTop: 10, marginBottom: 8 }}>{t('bgConsentDuration')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {BACKGROUND_HOURS.map(h => (
            <Pressable key={h} accessibilityRole="radio" accessibilityState={{ selected: h === hours }} onPress={() => setHours(h)}
              style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: RADIUS.tile,
                backgroundColor: h === hours ? c.accent : c.tile }}>
              <Text style={{ fontSize: 15, fontWeight: '600', color: h === hours ? c.onAccent : c.ink }}>{t('hours', { n: h })}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingBottom: 36 }}>
        <PrimaryButton label={t('start')} onPress={start} disabled={busy} />
        <Pressable accessibilityRole="button" onPress={onCancel} style={{ paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ color: c.secondary, fontSize: 15 }}>{t('cancel')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
