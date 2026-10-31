import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { useV2 } from '../i18n';
import { PrimaryButton } from '../components/Controls';
import { Icon } from '../components/Icon';
import type { StringKey } from '../strings';

const COPY: Record<'foreground' | 'background' | 'notifications', { title: StringKey; body: StringKey }> = {
  foreground: { title: 'primerForegroundTitle', body: 'primerForegroundBody' },
  background: { title: 'primerBackgroundTitle', body: 'primerBackgroundBody' },
  notifications: { title: 'primerNotificationsTitle', body: 'primerNotificationsBody' },
};

/** Explains WHY before Android shows its permission dialog. */
export function PermissionPrimer({ kind, denied, onContinue, onCancel }: {
  kind: 'foreground' | 'background' | 'notifications';
  denied?: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { t, c } = useV2();
  const copy = COPY[kind];
  return (
    <View style={{ flex: 1, backgroundColor: c.page, paddingHorizontal: 24, paddingTop: 110, paddingBottom: 36 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(47,124,246,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
        <Icon name={kind === 'notifications' ? 'bell' : 'locate'} color={c.accent} size={30} />
      </View>
      <Text style={{ fontSize: 24, fontWeight: '600', color: c.ink, marginBottom: 10 }}>{t(copy.title)}</Text>
      <Text style={{ fontSize: 16, color: c.secondary, lineHeight: 23 }}>{t(copy.body)}</Text>
      {denied ? (
        <Text style={{ fontSize: 14, color: c.danger, marginTop: 16 }}>
          {t(kind === 'background' ? 'backgroundDenied' : 'permissionDenied')}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      {denied ? (
        <PrimaryButton label={t('openSettings')} onPress={() => { void Linking.openSettings(); }} />
      ) : (
        <PrimaryButton label={t('continue')} onPress={onContinue} />
      )}
      <Pressable accessibilityRole="button" onPress={onCancel} style={{ paddingVertical: 14, alignItems: 'center' }}>
        <Text style={{ color: c.secondary, fontSize: 15 }}>{t('notNow')}</Text>
      </Pressable>
    </View>
  );
}
