import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createOwnProfile, loadOwnProfile, renameOwnProfile } from './firestoreProfile';

type State = 'loading' | 'missing' | 'ready' | 'error';
const friendlyError = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'permission-denied')
    return 'สิทธิ์ Firestore Staging ยังไม่พร้อม โปรด Deploy Rules ของ M1.0 ก่อน';
  return 'เชื่อมต่อโปรไฟล์ไม่ได้ โปรดตรวจสอบอินเทอร์เน็ตหรือกดลองใหม่';
};

/** Rendered only after Firebase Guest authentication and opt-in M1 Staging flag. */
export function UserProfilePanel() {
  const [state, setState] = useState<State>('loading');
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
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
      setMessage('บันทึกโปรไฟล์ส่วนตัวแล้ว');
    } catch (error) {
      if (!activeRef.current) return;
      if (error instanceof Error && error.message.startsWith('ชื่อที่แสดง')) {
        setMessage(error.message);
      } else {
        setMessage(friendlyError(error));
      }
    } finally {
      if (activeRef.current) setBusy(false);
    }
  }

  return <View style={styles.panel}>
    <Text style={styles.title}>โปรไฟล์ของฉัน · M1.0</Text>
    <Text style={styles.note}>โปรไฟล์นี้อ่านและแก้ไขได้เฉพาะบัญชีของคุณ ไม่บันทึก GPS หรือเบอร์โทร และยังไม่เปิดค้นหาสมาชิก</Text>
    {state === 'loading' ? <Text style={styles.note}>กำลังโหลดโปรไฟล์ส่วนตัว...</Text> : null}
    {state === 'error' ? (
      <Pressable accessibilityRole="button" onPress={() => { setState('loading'); void reload(() => activeRef.current); }} style={styles.button}>
        <Text style={styles.buttonText}>ลองโหลดอีกครั้ง</Text>
      </Pressable>
    ) : state !== 'loading' ? <>
      <TextInput
        accessibilityLabel="ชื่อที่แสดงในโปรไฟล์"
        placeholder="ชื่อที่แสดง (2–32 ตัวอักษร)"
        placeholderTextColor="#98aebb" value={name} onChangeText={setName}
        maxLength={32} style={styles.input}
      />
      <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={styles.button}>
        <Text style={styles.buttonText}>{busy ? 'กำลังบันทึก...' : state === 'ready' ? 'บันทึกชื่อที่แสดง' : 'สร้างโปรไฟล์ส่วนตัว'}</Text>
      </Pressable>
    </> : null}
    {message ? <Text accessibilityRole="alert" style={styles.note}>{message}</Text> : null}
    <Text style={styles.note}>แชร์ตำแหน่ง: ปิดอยู่เสมอ · คำขอเป็นเพื่อนจะเปิดใน M1.2</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel:{backgroundColor:'#132b3b',borderRadius:15,borderWidth:1,borderColor:'#355e6d',padding:16,gap:10},
  title:{color:'#50e2bb',fontSize:16,fontWeight:'800'},
  note:{color:'#b5cbd5',fontSize:12,lineHeight:19},
  input:{backgroundColor:'#0b2233',color:'white',borderWidth:1,borderColor:'#355e6d',borderRadius:11,padding:12,fontSize:15},
  button:{backgroundColor:'#18765e',paddingHorizontal:12,paddingVertical:11,borderRadius:12,alignItems:'center'},
  buttonText:{color:'white',fontSize:13,fontWeight:'700'},
});
