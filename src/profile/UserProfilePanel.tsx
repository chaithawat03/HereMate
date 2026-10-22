import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {usePreferences} from '../ui/PreferencesProvider';
import type {Palette,TranslationKey} from '../ui/preferencesModel';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createOwnProfile, loadOwnProfile, renameOwnProfile } from './firestoreProfile';

type State = 'loading' | 'missing' | 'ready' | 'error';
const friendlyError = (error: unknown):TranslationKey => {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'permission-denied')
    return 'firestorePermission';
  return 'profileUnavailable';
};

/** Rendered only after Firebase Guest authentication and opt-in M1 Staging flag. */
export function UserProfilePanel() {
  const {colors:c,t}=usePreferences();
  const styles=useMemo(()=>makeStyles(c),[c]);
  const [state, setState] = useState<State>('loading');
  const [name, setName] = useState('');
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const [busy, setBusy] = useState(false);
  const activeRef = useRef(true);
  const reload = useCallback(async (alive: () => boolean) => {
    try {
      const profile = await loadOwnProfile();
      if (!alive()) return;
      setName(profile?.displayName ?? '');
      setState(profile ? 'ready' : 'missing');
      setMessage(null);
    } catch (error) {
      if (!alive()) return;
      setState('error');
      setMessage(friendlyError(error));
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    void reload(() => activeRef.current);
    return () => { activeRef.current = false; };
  }, [reload]);

  async function save() {
    if (busy || state === 'loading') return;
    setBusy(true);
    setMessage(null);
    try {
      const result = state === 'ready'
        ? await renameOwnProfile(name)
        : await createOwnProfile(name);
      if (!activeRef.current) return;
      setName(result.displayName);
      setState('ready');
      setMessage('profileSaved');
    } catch (error) {
      if (!activeRef.current) return;
      if (error instanceof Error && error.message.startsWith('ชื่อที่แสดง')) {
        setMessage('invalidDisplayName');
      } else {
        setMessage(friendlyError(error));
      }
    } finally {
      if (activeRef.current) setBusy(false);
    }
  }

  return <View style={styles.panel}>
    <Text style={styles.title}>{t('profileTitle')}</Text>
    <Text style={styles.note}>{t('profileExplanation')}</Text>
    {state === 'loading' ? <Text style={styles.note}>{t('profileLoading')}</Text> : null}
    {state === 'error' ? (
      <Pressable accessibilityRole="button" onPress={() => { setState('loading'); void reload(() => activeRef.current); }} style={styles.button}>
        <Text style={styles.buttonText}>{t('retry')}</Text>
      </Pressable>
    ) : state !== 'loading' ? <>
      <TextInput
        accessibilityLabel={t("profileNameLabel")}
        placeholder={t("namePlaceholder")}
        placeholderTextColor={c.placeholder} value={name} onChangeText={setName}
        maxLength={32} style={styles.input}
      />
      <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={styles.button}>
        <Text style={styles.buttonText}>{busy ? t('saving') : state === 'ready' ? t('saveName') : t('createProfile')}</Text>
      </Pressable>
    </> : null}
    {message ? <Text accessibilityRole="alert" style={styles.note}>{t(message)}</Text> : null}
    <Text style={styles.note}>{t('profileNoSharing')}</Text>
  </View>;
}
const makeStyles=(c:Palette)=>StyleSheet.create({
  panel:{backgroundColor:c.surface,borderRadius:15,borderWidth:1,borderColor:c.line,padding:16,gap:10},
  title:{color:c.accent,fontSize:16,fontWeight:'800'},
  note:{color:c.muted,fontSize:12,lineHeight:19},
  input:{backgroundColor:c.field,color:c.text,borderWidth:1,borderColor:c.line,borderRadius:11,padding:12,fontSize:15},
  button:{backgroundColor:c.accent,paddingHorizontal:12,paddingVertical:11,borderRadius:12,alignItems:'center'},
  buttonText:{color:c.accentOn,fontSize:13,fontWeight:'700'},
});
