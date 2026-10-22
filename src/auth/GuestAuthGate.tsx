import React, { useEffect, useState } from 'react';
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

function toPublicMessage(error: unknown): string {
  // Never show raw Firebase errors, user credentials, custom tokens or stack traces.
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'auth/network-request-failed') return 'ไม่มีการเชื่อมต่อเครือข่าย โปรดลองอีกครั้ง';
  if (code === 'auth/operation-not-allowed') return 'Firebase Anonymous ยังไม่ได้เปิดใช้งานใน Staging';
  if (code === 'auth/too-many-requests') return 'มีคำขอมากเกินไป กรุณาลองใหม่ภายหลัง';
  return 'ไม่สามารถดำเนินการได้ โปรดลองอีกครั้ง';
}

export function GuestAuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
            setMessage('ไม่สามารถอ่านสถานะ Login ได้');
          }
        }
      );
    } catch {
      setState({ kind: 'error' });
      setMessage('การตั้งค่า Firebase Staging ไม่พร้อม');
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
  function googleResultMessage(result: GoogleResult): string | null {
    switch (result.kind) {
      case 'linked': return 'เชื่อม Google สำเร็จ · รักษาบัญชีและโปรไฟล์เดิมแล้ว';
      case 'signed-in': return 'เข้าสู่ระบบด้วย Google สำเร็จ';
      case 'already-google': return 'บัญชีนี้เชื่อมกับ Google อยู่แล้ว';
      case 'collision': return 'บัญชี Google นี้ถูกใช้กับอีกบัญชีแล้ว ระบบไม่สลับบัญชีหรือย้ายโปรไฟล์โดยอัตโนมัติ';
      case 'session-changed': return 'สถานะ Login เปลี่ยนระหว่างดำเนินการ กรุณาลองใหม่';
      case 'different-provider': return 'โปรดออกจากระบบบัญชีเดิมก่อนเปลี่ยนวิธีเข้าสู่ระบบ';
      case 'unavailable': return 'Google Sign-In ยังไม่พร้อม โปรดตรวจสอบบริการ Google แล้วลองใหม่';
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
      setMessage('ไม่สามารถเชื่อมต่อ Google ได้ กรุณาลองใหม่');
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
    return <View style={s.screen}><ActivityIndicator color="#50e2bb" /><Text style={s.info}>กำลังตรวจสอบสถานะ Login...</Text></View>;
  }
  if (state.kind === 'signed-out' || state.kind === 'error') {
    return <View style={s.screen}>
      <Text style={s.brand}>HereMate</Text>
      <Text style={s.info}>ทดสอบ Guest Login · Firebase Staging</Text>
      <Text style={s.note}>จะสร้างบัญชี Guest แบบไม่ระบุชื่อเมื่อคุณเลือกดำเนินการ การเข้าสู่ระบบไม่อ่าน GPS และไม่เข้าถึงรายชื่อผู้ติดต่อ หากต้องการทดสอบ GPS ต้องกดเริ่ม GPS หลัง Login เอง</Text>
      {message ? <Text accessibilityRole="alert" style={s.error}>{message}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="เข้าสู่ระบบแบบ Guest" disabled={busy}
        onPress={guestLogin} style={[s.action,busy && s.disabled]}>
        <Text style={s.actionText}>{busy ? 'กำลังเชื่อมต่อ...' : 'เข้าใช้งานแบบ Guest'}</Text>
      </Pressable>
      {googleEnabled ? <Pressable accessibilityRole="button" accessibilityLabel="เข้าสู่ระบบด้วย Google"
        disabled={busy} onPress={googleLogin} style={[s.googleButton,busy && s.disabled]}>
        <Text style={s.googleButtonText}>{busy ? "กำลังดำเนินการ..." : "เข้าสู่ระบบด้วย Google"}</Text>
      </Pressable> : null}
      <Text style={s.note}>การลงชื่อออกจาก Guest อาจทำให้ไม่สามารถกลับเข้าสู่บัญชี Guest เดิมได้ จนกว่าจะมีระบบเชื่อมบัญชี</Text>
    </View>;
  }
  return <View style={s.main}>
    <View style={s.ribbon}>
      <View style={s.flex}>
        <Text style={s.label}>FIREBASE STAGING · {state.kind === 'guest' ? 'GUEST' : 'SIGNED IN'}</Text>
        <Text style={s.uid} selectable={false}>UID: {state.uid.slice(0, 6)}… (ย่อเพื่อแสดงผล)</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="ออกจากระบบ Guest"
        disabled={busy} onPress={logout} style={[s.signout,busy && s.disabled]}>
        <Text style={s.signoutText}>{busy ? 'รอสักครู่' : 'ออกจากระบบ'}</Text>
      </Pressable>
    </View>
    {state.kind === "guest" && googleEnabled ? <Pressable accessibilityRole="button"
      accessibilityLabel="เชื่อมบัญชี Guest กับ Google" disabled={busy} onPress={googleLogin}
      style={[s.googleRibbon,busy && s.disabled]}>
      <Text style={s.googleButtonText}>{busy ? "กำลังเชื่อม Google..." : "เชื่อม Google เพื่อเก็บโปรไฟล์เดิม"}</Text>
    </Pressable> : null}
    {message ? <Text accessibilityRole="alert" style={s.error}>{message}</Text> : null}
    {children}
  </View>;
}

const s = StyleSheet.create({
  screen:{flex:1,backgroundColor:'#071725',justifyContent:'center',padding:24,gap:18,width:'100%',maxWidth:560,alignSelf:'center'},
  main:{flex:1,backgroundColor:'#071725'},
  flex:{flex:1},
  brand:{fontSize:30,fontWeight:'800',color:'#50e2bb'},
  info:{color:'#e8f4f8',fontSize:16},
  note:{color:'#aec4d0',fontSize:13,lineHeight:21},
  error:{color:'#ffb4a9',fontSize:12,padding:10},
  action:{backgroundColor:'#1f8067',padding:16,borderRadius:14,alignItems:'center'},
  actionText:{color:'white',fontSize:15,fontWeight:'800'},
  disabled:{opacity:.6},
  googleButton:{borderWidth:1,borderColor:'#66b9d7',padding:14,borderRadius:14,alignItems:'center'},
  googleRibbon:{padding:11,alignItems:'center',borderBottomWidth:1,borderColor:'#356b79'},
  googleButtonText:{color:'#e8f8ff',fontWeight:'700',fontSize:13},
  ribbon:{flexDirection:'row',alignItems:'center',paddingHorizontal:16,paddingVertical:12,minHeight:60,backgroundColor:'#102c39'},
  label:{color:'#50e2bb',fontWeight:'800',fontSize:11},
  uid:{color:'#9bb0bf',fontSize:12,marginTop:3},
  signout:{paddingHorizontal:14,paddingVertical:10,borderWidth:1,borderColor:'#527b8e',borderRadius:12},
  signoutText:{color:'#edf7f8',fontSize:12,fontWeight:'700'}
});
