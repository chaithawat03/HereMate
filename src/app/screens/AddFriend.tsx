import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { useHereMate } from '../../data/ModeProvider';
import type { FriendRequestView } from '../../data/types';
import { useV2 } from '../i18n';
import { RADIUS } from '../theme';
import { PrimaryButton, Section } from '../components/Controls';
import { Icon } from '../components/Icon';

export function AddFriend({ requests, onClose, onToast }: {
  requests: FriendRequestView[]; onClose: () => void; onToast: (m: string) => void;
}) {
  const { t, c } = useV2();
  const { source } = useHereMate();
  const [code, setCode] = useState('');
  const [myCode, setMyCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    source.profile.get().then(p => { if (alive) setMyCode(p.friendCode); }, () => {});
    return () => { alive = false; };
  }, [source]);

  async function send() {
    setBusy(true);
    try { await source.friends.sendRequest(code); setCode(''); onToast(t('requestSent')); }
    catch { onToast(t('errorGeneric')); }
    finally { setBusy(false); }
  }
  async function respond(id: string, accept: boolean) {
    try { await source.friends.respond(id, accept); } catch { onToast(t('errorGeneric')); }
  }
  const incoming = requests.filter(r => r.direction === 'incoming');
  const outgoing = requests.filter(r => r.direction === 'outgoing');

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: 18, paddingBottom: 12 }}>
        <Text style={{ flex: 1, fontSize: 24, fontWeight: '600', color: c.ink }}>{t('addFriend')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('cancel')} onPress={onClose}
          style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.tile, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" color={c.secondary} size={16} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Section title={t('yourCode')}>
          <Pressable accessibilityRole="button" onPress={() => myCode && Share.share({ message: myCode })} style={{ paddingVertical: 14, flexDirection: 'row', alignItems: 'center' }}>
            <Text selectable numberOfLines={1} style={{ flex: 1, fontSize: 17, color: c.ink, fontWeight: '600' }}>{myCode || '…'}</Text>
            <Text style={{ color: c.accent, fontSize: 14 }}>{t('shareCode')}</Text>
          </Pressable>
        </Section>

        <Section title={t('enterFriendCode')}>
          <TextInput value={code} onChangeText={setCode} placeholder={t('friendCodePlaceholder')} autoCapitalize="none" autoCorrect={false}
            placeholderTextColor={c.secondary} style={{ paddingVertical: 12, fontSize: 16, color: c.ink }} />
        </Section>
        <PrimaryButton label={t('sendRequest')} onPress={send} disabled={busy || !code.trim()} />

        {incoming.length ? (
          <View style={{ marginTop: 22 }}>
            <Section title={t('incomingRequests')}>
              {incoming.map(r => (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: c.ink }}>{r.name}</Text>
                  <Pressable accessibilityRole="button" onPress={() => respond(r.id, false)} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
                    <Text style={{ color: c.secondary }}>{t('decline')}</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => respond(r.id, true)}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: c.accent, borderRadius: RADIUS.pill }}>
                    <Text style={{ color: c.onAccent }}>{t('accept')}</Text>
                  </Pressable>
                </View>
              ))}
            </Section>
          </View>
        ) : null}

        {outgoing.length ? (
          <Section title={t('outgoingRequests')}>
            {outgoing.map(r => (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, color: c.ink }}>{r.name}</Text>
                <Pressable accessibilityRole="button" onPress={() => respond(r.id, false)} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
                  <Text style={{ color: c.secondary }}>{t('cancel')}</Text>
                </Pressable>
              </View>
            ))}
          </Section>
        ) : null}
      </ScrollView>
    </View>
  );
}
