import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useHereMate } from '../../data/ModeProvider';
import { useV2 } from '../i18n';
import { useCaps } from '../useData';
import { RADIUS } from '../theme';
import { Icon } from '../components/Icon';
import { SecondaryButton, PrimaryButton } from '../components/Controls';

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const { t, c } = useV2();
  const { source, switchTo } = useHereMate();
  const caps = useCaps();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); onSignedIn(); } catch { setError(t('signInFailed')); } finally { setBusy(false); }
  }
  async function tryDemo() {
    setBusy(true);
    try { await switchTo('demo'); onSignedIn(); } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.page, paddingHorizontal: 24, paddingTop: 96, paddingBottom: 32 }}>
      <View style={{ alignItems: 'center' }}>
        <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: c.ink, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Icon name="places" color={c.page} size={30} />
        </View>
        <Text style={{ fontSize: 28, fontWeight: '600', color: c.ink }}>{t('appName')}</Text>
        <Text style={{ fontSize: 15, color: c.secondary, marginTop: 6 }}>{t('tagline')}</Text>
      </View>

      <View style={{ flex: 1 }} />

      {busy ? <ActivityIndicator color={c.accent} style={{ marginBottom: 16 }} /> : null}
      {error ? <Text style={{ color: c.danger, textAlign: 'center', marginBottom: 12 }}>{error}</Text> : null}

      <View style={{ gap: 10 }}>
        <SecondaryButton label={t('continueGoogle')} onPress={() => run(() => source.session.signInGoogle())} />
        {caps.phoneLogin && !phoneOpen ? (
          <SecondaryButton label={t('phoneAndPassword')} onPress={() => setPhoneOpen(true)} />
        ) : null}
        {caps.phoneLogin && phoneOpen ? (
          <View style={{ gap: 8 }}>
            <TextInput value={phone} onChangeText={setPhone} placeholder={t('phone')} keyboardType="phone-pad" placeholderTextColor={c.secondary}
              style={{ backgroundColor: c.card, borderRadius: RADIUS.tile, paddingHorizontal: 14, paddingVertical: 12, color: c.ink, fontSize: 16 }} />
            <TextInput value={password} onChangeText={setPassword} placeholder={t('password')} secureTextEntry placeholderTextColor={c.secondary}
              style={{ backgroundColor: c.card, borderRadius: RADIUS.tile, paddingHorizontal: 14, paddingVertical: 12, color: c.ink, fontSize: 16 }} />
            <PrimaryButton label={t('signIn')} disabled={!phone.trim() || !password} onPress={() => run(() => source.session.signInPhone(phone, password))} />
          </View>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => run(() => source.session.signInGuest())} style={{ paddingVertical: 10, alignItems: 'center' }}>
          <Text style={{ color: c.secondary, fontSize: 15 }}>{t('useAsGuest')}</Text>
        </Pressable>
      </View>

      {source.mode === 'live' ? (
        <Pressable accessibilityRole="button" onPress={tryDemo}
          style={{ marginTop: 12, paddingTop: 16, borderTopColor: c.divider, borderTopWidth: 0.5, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' }}>
          <Text style={{ color: c.accent, fontSize: 15, fontWeight: '600' }}>{t('tryDemo')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
