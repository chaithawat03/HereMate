import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { toLocalSample, type LocalSample } from './locationLogic';

type Mode = 'off' | 'starting' | 'on' | 'denied' | 'error';

/** Guest-only foreground on-device GPS probe. No backend, storage or background tasks. */
export function LocalLocationPanel() {
  const [mode, setMode] = useState<Mode>('off');
  const [sample, setSample] = useState<LocalSample | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const runRef = useRef(0);
  const activeRef = useRef(true);

  const stop = useCallback(() => {
    runRef.current += 1;
    watchRef.current?.remove();
    watchRef.current = null;
    setSample(null);
    setMessage(null);
    setMode('off');
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const listener = AppState.addEventListener('change', next => {
      if (next === 'background') stop();
    });
    return () => {
      activeRef.current = false;
      runRef.current += 1;
      watchRef.current?.remove();
      watchRef.current = null;
    };
  }, [stop]);

  async function start() {
    if (mode === 'starting' || mode === 'on' || !activeRef.current) return;
    const run = ++runRef.current;
    const current = () => activeRef.current && run === runRef.current;
    setSample(null);
    setMessage(null);
    setMode('starting');
    try {
      if (!(await Location.hasServicesEnabledAsync())) {
        if (current()) {
          setMode('error');
          setMessage('กรุณาเปิด Location ของโทรศัพท์ก่อน');
        }
        return;
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!current()) return;
      if (!permission.granted) {
        setMode('denied');
        setMessage('ไม่ได้รับสิทธิ์ตำแหน่ง คุณสามารถอนุญาตได้ใน Settings ของโทรศัพท์');
        return;
      }
      const watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        position => {
          if (!current()) return;
          const point = toLocalSample(position);
          if (point) setSample(point);
        },
        () => {
          if (!current()) return;
          stop();
          setMode('error');
          setMessage('อ่านตำแหน่งไม่สำเร็จ โปรดตรวจสอบ Location แล้วลองใหม่');
        },
      );
      if (!current()) { watcher.remove(); return; }
      watchRef.current = watcher;
      setMode('on');
    } catch {
      if (!current()) return;
      stop();
      setMode('error');
      setMessage('ไม่สามารถเริ่ม GPS ได้ โปรดลองใหม่');
    }
  }

  return (
    <View style={styles.panel} accessibilityLabel="ทดสอบ GPS จริงเฉพาะบนเครื่อง">
      <Text style={styles.title}>GPS จริง · เฉพาะบนเครื่อง</Text>
      <Text style={styles.details}>กดเริ่มเพื่ออนุญาตตำแหน่งขณะใช้แอป พิกัดจะปรากฏบนหน้าจอนี้เท่านั้น ไม่แชร์ให้เพื่อน ไม่ส่ง Firebase และไม่บันทึกลงฐานข้อมูล</Text>
      <View style={styles.row}>
        <Text style={styles.status}>สถานะ: {mode === 'on' ? 'กำลังรับ GPS' : mode === 'starting' ? 'กำลังขอสิทธิ์ / รอ GPS' : mode === 'off' ? 'ปิด' : mode === 'denied' ? 'ไม่อนุญาต' : 'มีข้อผิดพลาด'}</Text>
        <Pressable accessibilityRole="button"
          accessibilityLabel={mode === 'on' || mode === 'starting' ? 'หยุดอ่าน GPS' : 'เริ่มอ่าน GPS'}
          onPress={mode === 'on' || mode === 'starting' ? stop : start}
          style={[styles.button, (mode === 'on' || mode === 'starting') && styles.stopButton]}>
          <Text style={styles.buttonText}>{mode === 'on' || mode === 'starting' ? 'หยุด GPS' : 'เริ่ม GPS'}</Text>
        </Pressable>
      </View>
      {sample && mode === 'on' ? (
        <View style={styles.readout}>
          <Text style={styles.value}>Latitude: {sample.latitude.toFixed(6)}</Text>
          <Text style={styles.value}>Longitude: {sample.longitude.toFixed(6)}</Text>
          <Text style={styles.value}>ความแม่นยำ: {sample.accuracyMeters === null ? 'ไม่ทราบ' : '±' + sample.accuracyMeters + ' เมตร'}</Text>
          <Text style={styles.value}>ข้อมูลเวลา: {new Date(sample.measuredAt).toLocaleTimeString('th-TH')}</Text>
        </View>
      ) : mode === 'on' ? <Text style={styles.details}>กำลังรอพิกัดแรกจากอุปกรณ์...</Text> : null}
      {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
      <Text style={styles.foot}>เมื่อสลับแอปไปเบื้องหลังหรือออกจากระบบจะหยุดอ่าน GPS; เริ่มใหม่ได้ด้วยปุ่มเริ่ม</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  panel: { backgroundColor: '#132b3b', borderWidth: 1, borderColor: '#37786f', padding: 16, gap: 11, borderRadius: 15 },
  title: { color: '#50e2bb', fontWeight: '800', fontSize: 16 },
  details: { color: '#c0d3dd', fontSize: 13, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  status: { flex: 1, color: '#f0f5f8', fontSize: 13, fontWeight: '700' },
  button: { backgroundColor: '#14785c', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12 },
  stopButton: { backgroundColor: '#7c4650' },
  buttonText: { color: 'white', fontWeight: '800', fontSize: 13 },
  readout: { gap: 4, padding: 11, backgroundColor: '#0a2232', borderRadius: 12 },
  value: { color: '#f0f5f8', fontSize: 13 },
  error: { color: '#ffb4a9', fontSize: 13, lineHeight: 20 },
  foot: { color: '#9bb0bf', fontSize: 12, lineHeight: 18 },
});
