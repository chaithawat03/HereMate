import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useHereMate } from '../../data/ModeProvider';
import type { Capabilities, Friend, Mode, SharingState } from '../../data/types';
import { useV2 } from '../i18n';
import { RADIUS } from '../theme';
import { Avatar, ComingSoon, Row, Section, ToggleRow } from '../components/Controls';

export function MeScreen({ caps, sharing, friends, onMode, onPickFriendToShare, onStartBackground, onToast }: {
  caps: Capabilities;
  sharing: SharingState;
  friends: Friend[];
  onMode: (m: Mode) => void;
  onPickFriendToShare: () => void;
  onStartBackground: (friendId: string) => void;
  onToast: (m: string) => void;
}) {
  const { t, c, lang, theme, setTheme, setLanguage } = useV2();
  const { source, mode } = useHereMate();
  const [profile, setProfile] = useState<{ displayName: string; friendCode: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    let alive = true;
    source.profile.get().then(p => { if (alive) { setProfile(p); setName(p.displayName); } }, () => {});
    return () => { alive = false; };
  }, [source]);

  const sharingWith = sharing.foregroundWith ?? sharing.background?.withId ?? null;
  const bg = sharing.background;
  const nameOf = (id: string) => friends.find(f => f.id === id)?.name ?? '';
  const timeOf = (ms: number) => new Date(ms).toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

  async function stopAll() {
    try { await source.location.stopAll(); onToast(t('stoppedAll')); } catch { onToast(t('errorGeneric')); }
  }
  async function saveName() {
    try { await source.profile.rename(name); setProfile(p => (p ? { ...p, displayName: name.trim() } : p)); setEditing(false); }
    catch { onToast(t('errorGeneric')); }
  }
  function toggleShare(on: boolean) {
    if (on) onPickFriendToShare();
    else void source.location.stop().catch(() => onToast(t('errorGeneric')));
  }
  function toggleBackground(on: boolean) {
    if (!on) { void source.location.stopBackground().catch(() => onToast(t('errorGeneric'))); return; }
    const target = sharing.foregroundWith ?? friends.find(f => f.consentMine && f.consentTheirs)?.id;
    if (target) onStartBackground(target);
    else onPickFriendToShare();
  }
  function signOut() {
    Alert.alert(t('signOut'), '', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('signOut'), style: 'destructive', onPress: () => { void source.session.signOut(); } },
    ]);
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.page }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 56, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
        <Avatar id={profile?.friendCode ?? 'me'} initials={Array.from(profile?.displayName ?? '?').slice(0, 3).join('')} size={56} />
        <View style={{ flex: 1, marginLeft: 14 }}>
          {editing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TextInput value={name} onChangeText={setName} autoFocus
                style={{ flex: 1, fontSize: 18, color: c.ink, backgroundColor: c.card, borderRadius: RADIUS.tile, paddingHorizontal: 10, paddingVertical: 6 }} />
              <Pressable accessibilityRole="button" onPress={saveName} style={{ paddingHorizontal: 10 }}>
                <Text style={{ color: c.accent, fontWeight: '600' }}>{t('save')}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => setEditing(true)}>
              <Text numberOfLines={1} style={{ fontSize: 22, fontWeight: '600', color: c.ink }}>{profile?.displayName ?? '…'}</Text>
            </Pressable>
          )}
          <Text numberOfLines={1} selectable style={{ fontSize: 13, color: c.secondary, marginTop: 2 }}>
            {profile ? t('friendCode', { code: profile.friendCode }) : ''}
          </Text>
        </View>
      </View>

      <Section>
        <ToggleRow label={t('shareMyLocation')} value={sharingWith !== null} onChange={toggleShare}
          hint={sharingWith ? nameOf(sharingWith) : undefined} />
        {caps.backgroundSharing ? (
          <ToggleRow label={t('shareWhenClosed')} value={bg !== null} onChange={toggleBackground}
            hint={bg ? t('shareWhenClosedOn', { name: nameOf(bg.withId), time: timeOf(bg.deadlineMs) }) : undefined} />
        ) : (
          <View style={{ paddingVertical: 10 }}>
            <Text style={{ fontSize: 15, color: c.ink, marginBottom: 8 }}>{t('shareWhenClosed')}</Text>
            <ComingSoon compact />
          </View>
        )}
      </Section>

      <Section>
        <Row label={t('language')} value={t('languageValue')} onPress={() => setLanguage(lang === 'th' ? 'en' : 'th')} />
        <Row label={t('theme')} value={theme === 'dark' ? t('themeDark') : t('themeLight')} onPress={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <Row label={t('mode')} value={mode === 'demo' ? t('modeDemo') : t('modeLive')} onPress={() => onMode(mode === 'demo' ? 'live' : 'demo')} />
      </Section>

      <Section>
        <Row label={t('stopAllNow')} onPress={stopAll} danger />
      </Section>

      <Pressable accessibilityRole="button" onPress={signOut} style={{ alignItems: 'center', paddingVertical: 12 }}>
        <Text style={{ color: c.secondary, fontSize: 15 }}>{t('signOut')}</Text>
      </Pressable>
    </ScrollView>
  );
}
