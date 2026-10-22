import React, { useEffect, useMemo, useState } from 'react';
import { usePreferences } from '../ui/PreferencesProvider';
import type { Palette, TranslationKey } from '../ui/preferencesModel';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { continueStagingGoogleWithNativeToken } from './googleAccountFirebase';
import { obtainNativeGoogleIdToken } from './nativeGoogleSignIn';
import type { Result as GoogleResult } from './googleAccountFlow';
import {
  getStagingGuestAuth, startGuestSession, stopGuestSession, watchGuestSession
} from './firebaseGuest';

type State =
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  | { kind: 'guest'; uid: string }
  | { kind: 'linked'; uid: string }
  | { kind: 'error' };

function toPublicMessage(error: unknown): TranslationKey {
  // Never show raw Firebase errors, user credentials, custom tokens or stack traces.
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'auth/network-request-failed') return 'authNetwork';
  if (code === 'auth/operation-not-allowed') return 'authDisabled';
  if (code === 'auth/too-many-requests') return 'authTooMany';
  return 'authGeneric';
}

export function GuestAuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const {colors:c,t} = usePreferences();
  const s=useMemo(()=>makeStyles(c),[c]);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const googleEnabled = Platform.OS === 'android' &&
    process.env.EXPO_PUBLIC_ENVIRONMENT === 'staging' &&
    process.env.EXPO_PUBLIC_ENABLE_FIREBASE_GUEST === 'true' &&
    process.env.EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN === 'true';

  useEffect(() => {
    let alive = true;
    let unsubscribe = () => {};
    try {
      const auth = getStagingGuestAuth();
      unsubscribe = watchGuestSession(auth,
        user => {
          if (!alive) return;
          setState(user
            ? { kind: user.isAnonymous ? 'guest' : 'linked', uid: user.uid }
            : { kind: 'signed-out' });
          setMessage(null);
        },
        () => {
          if (alive) {
            setState({ kind: 'error' });
            setMessage('authStateError');
          }
        }
      );
    } catch {
      setState({ kind: 'error' });
      setMessage('firebaseNotReady');
    }
    return () => { alive = false; unsubscribe(); };
  }, []);

  async function guestLogin() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try { await startGuestSession(getStagingGuestAuth()); }
    catch (error) { setMessage(toPublicMessage(error)); }
    finally { setBusy(false); }
  }
  function googleResultMessage(result: GoogleResult): TranslationKey | null {
    switch (result.kind) {
      case 'linked': return 'googleLinked';
      case 'signed-in': return 'googleSignedIn';
      case 'already-google': return 'googleAlready';
      case 'collision': return 'googleCollision';
      case 'session-changed': return 'googleSessionChanged';
      case 'different-provider': return 'googleDifferentProvider';
      case 'unavailable': return 'googleUnavailable';
      default: return null;
    }
  }
  async function googleLogin() {
    if (busy || !googleEnabled) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await continueStagingGoogleWithNativeToken(obtainNativeGoogleIdToken);
      setMessage(googleResultMessage(result));
    } catch {
      // Never echo native errors, provider tokens, emails or Firebase credentials.
      setMessage('googleError');
    } finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try { await stopGuestSession(getStagingGuestAuth()); }
    catch (error) { setMessage(toPublicMessage(error)); }
    finally { setBusy(false); }
  }

  if (state.kind === 'checking') {
    return <View style={s.screen}><ActivityIndicator color={c.accent} /><Text style={s.info}>{t('loginChecking')}</Text></View>;
  }
  if (state.kind === 'signed-out' || state.kind === 'error') {
    return <View style={s.screen}>
      <Text style={s.brand}>HereMate</Text>
      <Text style={s.info}>{t('guestTrial')}</Text>
      <Text style={s.note}>{t('guestExplainer')}</Text>
      {message ? <Text accessibilityRole="alert" style={s.error}>{t(message)}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={t("guestLoginLabel")} disabled={busy}
        onPress={guestLogin} style={[s.action,busy && s.disabled]}>
        <Text style={s.actionText}>{busy ? t('connecting') : t('guestLogin')}</Text>
      </Pressable>
      {googleEnabled ? <Pressable accessibilityRole="button" accessibilityLabel={t("googleLogin")}
        disabled={busy} onPress={googleLogin} style={[s.googleButton,busy && s.disabled]}>
        <Text style={s.googleButtonText}>{busy ? t('processing') : t('googleLogin')}</Text>
      </Pressable> : null}
      <Text style={s.note}>{t('guestWarning')}</Text>
    </View>;
  }
  return <View style={s.main}>
    <View style={s.ribbon}>
      <View style={s.flex}>
        <Text style={s.label}>FIREBASE STAGING · {t(state.kind === 'guest' ? 'authGuest' : 'authSignedIn')}</Text>
        <Text style={s.uid} selectable={false}>UID: {state.uid.slice(0, 6)}… {t('uidShort')}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t("logoutLabel")}
        disabled={busy} onPress={logout} style={[s.signout,busy && s.disabled]}>
        <Text style={s.signoutText}>{busy ? t('pleaseWait') : t('logout')}</Text>
      </Pressable>
    </View>
    {state.kind === "guest" && googleEnabled ? <Pressable accessibilityRole="button"
      accessibilityLabel={t("linkGoogleLabel")} disabled={busy} onPress={googleLogin}
      style={[s.googleRibbon,busy && s.disabled]}>
      <Text style={s.googleButtonText}>{busy ? t('linkingGoogle') : t('linkGoogle')}</Text>
    </Pressable> : null}
    {message ? <Text accessibilityRole="alert" style={s.error}>{t(message)}</Text> : null}
    {children}
  </View>;
}

const makeStyles=(c:Palette)=>StyleSheet.create({
  screen:{flex:1,backgroundColor:c.background,justifyContent:'center',padding:24,gap:18,width:'100%',maxWidth:560,alignSelf:'center'},
  main:{flex:1,backgroundColor:c.background},
  flex:{flex:1},
  brand:{fontSize:30,fontWeight:'800',color:c.accent},
  info:{color:c.text,fontSize:16},
  note:{color:c.muted,fontSize:13,lineHeight:21},
  error:{color:c.error,fontSize:12,padding:10},
  action:{backgroundColor:c.accent,padding:16,borderRadius:14,alignItems:'center'},
  actionText:{color:c.accentOn,fontSize:15,fontWeight:'800'},
  disabled:{opacity:.6},
  googleButton:{borderWidth:1,borderColor:c.line,padding:14,borderRadius:14,alignItems:'center'},
  googleRibbon:{padding:11,alignItems:'center',borderBottomWidth:1,borderColor:c.line},
  googleButtonText:{color:c.text,fontWeight:'700',fontSize:13},
  ribbon:{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:12,minHeight:60,backgroundColor:c.ribbon},
  label:{color:c.accent,fontWeight:'800',fontSize:11},
  uid:{color:c.muted,fontSize:12,marginTop:3},
  signout:{paddingHorizontal:14,paddingVertical:10,borderWidth:1,borderColor:c.line,borderRadius:12},
  signoutText:{color:c.text,fontSize:12,fontWeight:'700'}
});
