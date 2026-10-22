import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {usePreferences} from '../ui/PreferencesProvider';
import type {Palette,TranslationKey} from '../ui/preferencesModel';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { toLocalSample, type LocalSample } from './locationLogic';
import { shouldCancelForAppState } from './gpsLifecycle';

type Mode = 'off' | 'starting' | 'on' | 'denied' | 'error';

/** Guest-only foreground on-device GPS probe. No backend, storage or background tasks. */
export function LocalLocationPanel() {
  const {colors:c,t,language}=usePreferences();
  const styles=useMemo(()=>makeStyles(c),[c]);
  const [mode, setMode] = useState<Mode>('off');
  const [sample, setSample] = useState<LocalSample | null>(null);
  const [message, setMessage] = useState<TranslationKey | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const runRef = useRef(0);
  const activeRef = useRef(true);
  const permissionPendingRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const resumeWhenActiveRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    runRef.current += 1;
    permissionPendingRef.current = false;
    resumeWhenActiveRef.current?.();
    resumeWhenActiveRef.current = null;
    watchRef.current?.remove();
    watchRef.current = null;
    setSample(null);
    setMessage(null);
    setMode('off');
  }, []);

  useEffect(() => {
    activeRef.current = true;
    const listener = AppState.addEventListener('change', next => {
      appStateRef.current = next;
      if (next === 'active') {
        resumeWhenActiveRef.current?.();
        resumeWhenActiveRef.current = null;
      }
      if (shouldCancelForAppState(next, permissionPendingRef.current)) stop();
    });
    return () => {
      listener.remove();
      activeRef.current = false;
      permissionPendingRef.current = false;
      resumeWhenActiveRef.current?.();
      resumeWhenActiveRef.current = null;
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
          setMessage('enablePhoneLocation');
        }
        return;
      }
      // Android permission dialogs can temporarily report AppState background.
      // Defer lifecycle cancellation until the permission dialog has closed.
      permissionPendingRef.current = true;
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!current()) return;
      if (!permission.granted) {
        permissionPendingRef.current = false;
        setMode('denied');
        setMessage('locationDenied');
        return;
      }
      // Do not start a GPS subscription while the user is really outside the app.
      // Resume after Android reports active again; Stop/unmount invalidate run.
      if (appStateRef.current !== 'active') {
        await new Promise<void>(resolve => {
          if (appStateRef.current === 'active') resolve();
          else resumeWhenActiveRef.current = resolve;
        });
      }
      if (!current()) return;
      permissionPendingRef.current = false;
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
          setMessage('locationReadError');
        },
      );
      if (!current()) { watcher.remove(); return; }
      watchRef.current = watcher;
      setMode('on');
    } catch {
      if (!current()) return;
      permissionPendingRef.current = false;
      stop();
      setMode('error');
      setMessage('locationStartError');
    }
  }

  return (
    <View style={styles.panel} accessibilityLabel={t("gpsPanelLabel")}>
      <Text style={styles.title}>{t('gpsTitle')}</Text>
      <Text style={styles.details}>{t('gpsExplanation')}</Text>
      <View style={styles.row}>
        <Text style={styles.status}>{t('gpsStatus')}: {t(mode === 'on' ? 'gpsOn' : mode === 'starting' ? 'gpsStarting' : mode === 'off' ? 'gpsOff' : mode === 'denied' ? 'gpsDenied' : 'gpsError')}</Text>
        <Pressable accessibilityRole="button"
          accessibilityLabel={t(mode === 'on' || mode === 'starting' ? 'gpsStopLabel' : 'gpsStartLabel')}
          onPress={mode === 'on' || mode === 'starting' ? stop : start}
          style={[styles.button, (mode === 'on' || mode === 'starting') && styles.stopButton]}>
          <Text style={[styles.buttonText, (mode === 'on' || mode === 'starting') && {color:'#FFFFFF'}]}>{t(mode === 'on' || mode === 'starting' ? 'gpsStop' : 'gpsStart')}</Text>
        </Pressable>
      </View>
      {sample && mode === 'on' ? (
        <View style={styles.readout}>
          <Text style={styles.value}>{t('latitude')}: {sample.latitude.toFixed(6)}</Text>
          <Text style={styles.value}>{t('longitude')}: {sample.longitude.toFixed(6)}</Text>
          <Text style={styles.value}>{t('accuracy')}: {sample.accuracyMeters === null ? t('accuracyUnknown') : '±' + sample.accuracyMeters + ' ' + t('meter')}</Text>
          <Text style={styles.value}>{t('measuredAt')}: {new Date(sample.measuredAt).toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-US')}</Text>
        </View>
      ) : mode === 'on' ? <Text style={styles.details}>{t('waitingFix')}</Text> : null}
      {message ? <Text accessibilityRole="alert" style={styles.error}>{t(message)}</Text> : null}
      <Text style={styles.foot}>{t('gpsFoot')}</Text>
    </View>
  );
}
const makeStyles=(c:Palette)=>StyleSheet.create({
  panel: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, padding: 16, gap: 11, borderRadius: 15 },
  title: { color: c.accent, fontWeight: '800', fontSize: 16 },
  details: { color: c.muted, fontSize: 13, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  status: { flex: 1, color: c.text, fontSize: 13, fontWeight: '700' },
  button: { backgroundColor: c.accent, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12 },
  stopButton: { backgroundColor: c.dangerButton },
  buttonText: { color: c.accentOn, fontWeight: '800', fontSize: 13 },
  readout: { gap: 4, padding: 11, backgroundColor: c.surfaceAlt, borderRadius: 12 },
  value: { color: c.text, fontSize: 13 },
  error: { color: c.error, fontSize: 13, lineHeight: 20 },
  foot: { color: c.muted, fontSize: 12, lineHeight: 18 },
});
