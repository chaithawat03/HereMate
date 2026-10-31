// Small shared controls: mode switch, tab bar, avatar, buttons, rows, coming-soon notice, toast.
import React, { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Pressable, Switch, Text, View } from 'react-native';
import type { Mode } from '../../data/types';
import type { Tab } from '../nav';
import { useV2 } from '../i18n';
import { avatarTint, RADIUS } from '../theme';
import { Icon, type IconName } from './Icon';

export function ModeSwitch({ mode, onChange, busy }: { mode: Mode; onChange: (m: Mode) => void; busy?: boolean }) {
  const { t, c } = useV2();
  const seg = (m: Mode, label: string) => {
    const on = mode === m;
    return (
      <Pressable
        key={m}
        accessibilityRole="button"
        accessibilityState={{ selected: on, busy }}
        onPress={() => !on && !busy && onChange(m)}
        style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: RADIUS.pill, backgroundColor: on ? c.ink : 'transparent' }}
      >
        <Text style={{ fontSize: 13, color: on ? (c.ink === '#1D2228' ? '#FFFFFF' : '#0E151D') : c.secondary, fontWeight: on ? '600' : '400' }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: 'row', padding: 3, borderRadius: RADIUS.pill, backgroundColor: c.glass, borderColor: c.glassBorder, borderWidth: 0.5, opacity: busy ? 0.6 : 1 }}>
      {seg('demo', t('modeDemo'))}
      {seg('live', t('modeLive'))}
    </View>
  );
}

export function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { t, c } = useV2();
  const items: Array<{ id: Tab; icon: IconName; label: string }> = [
    { id: 'friends', icon: 'friends', label: t('tabFriends') },
    { id: 'places', icon: 'places', label: t('tabPlaces') },
    { id: 'me', icon: 'me', label: t('tabMe') },
  ];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingTop: 8, paddingBottom: 18, backgroundColor: c.glassStrong, borderTopColor: c.divider, borderTopWidth: 0.5 }}>
      {items.map(it => {
        const on = it.id === tab;
        const color = on ? c.accent : c.secondary;
        return (
          <Pressable key={it.id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={it.label}
            onPress={() => onTab(it.id)} style={{ alignItems: 'center', minWidth: 72 }}>
            <Icon name={it.icon} color={color} />
            <Text style={{ fontSize: 11, color, marginTop: 3, fontWeight: on ? '600' : '400' }}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Avatar({ id, initials, size = 36, ring }: { id: string; initials: string; size?: number; ring?: string }) {
  const tint = avatarTint(id);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg, alignItems: 'center', justifyContent: 'center', borderWidth: ring ? 2.5 : 0, borderColor: ring }}>
      <Text numberOfLines={1} style={{ color: tint.fg, fontSize: size * 0.34, fontWeight: '600' }}>{initials}</Text>
    </View>
  );
}

export function PrimaryButton({ label, onPress, danger, disabled }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  const { c } = useV2();
  return (
    <Pressable accessibilityRole="button" onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({ backgroundColor: danger ? c.danger : c.accent, borderRadius: RADIUS.tile, paddingVertical: 14, alignItems: 'center', opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}>
      <Text style={{ color: c.onAccent, fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, icon }: { label: string; onPress: () => void; icon?: ReactNode }) {
  const { c } = useV2();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', backgroundColor: c.card, borderColor: c.glassBorder, borderWidth: 0.5, borderRadius: RADIUS.tile, paddingVertical: 13, opacity: pressed ? 0.85 : 1 })}>
      {icon}
      <Text style={{ color: c.ink, fontSize: 15, marginLeft: icon ? 8 : 0 }}>{label}</Text>
    </Pressable>
  );
}

export function ActionTile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { c } = useV2();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingVertical: 12, backgroundColor: c.tile, borderRadius: RADIUS.tile, opacity: pressed ? 0.8 : 1 })}>
      <Icon name={icon} color={c.accent} />
      <Text style={{ color: c.ink, fontSize: 12, marginTop: 4 }}>{label}</Text>
    </Pressable>
  );
}

export function Row({ label, value, onPress, children, danger }: { label: string; value?: string; onPress?: () => void; children?: ReactNode; danger?: boolean }) {
  const { c } = useV2();
  return (
    <Pressable disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 10, borderBottomColor: c.divider, borderBottomWidth: 0.5 }}>
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: danger ? c.danger : c.ink }}>{label}</Text>
      {value ? <Text numberOfLines={1} style={{ fontSize: 15, color: c.secondary, marginRight: onPress ? 4 : 0, maxWidth: '55%' }}>{value}</Text> : null}
      {children}
    </Pressable>
  );
}

export function ToggleRow({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const { c } = useV2();
  return (
    <View style={{ paddingVertical: 10, borderBottomColor: c.divider, borderBottomWidth: 0.5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontSize: 15, color: c.ink }}>{label}</Text>
        <Switch value={value} onValueChange={onChange} trackColor={{ true: c.live, false: c.toggleOff }} thumbColor="#FFFFFF" />
      </View>
      {hint ? <Text style={{ fontSize: 12, color: c.secondary, marginTop: 2 }}>{hint}</Text> : null}
    </View>
  );
}

export function Section({ children, title }: { children: ReactNode; title?: string }) {
  const { c } = useV2();
  return (
    <View style={{ marginBottom: 14 }}>
      {title ? <Text style={{ fontSize: 13, color: c.secondary, marginBottom: 6, marginLeft: 4 }}>{title}</Text> : null}
      <View style={{ backgroundColor: c.card, borderRadius: RADIUS.tile, paddingHorizontal: 14 }}>{children}</View>
    </View>
  );
}

export function ComingSoon({ compact }: { compact?: boolean }) {
  const { t, c } = useV2();
  return (
    <View style={{ backgroundColor: c.tile, borderRadius: RADIUS.tile, padding: compact ? 10 : 14 }}>
      <Text style={{ fontSize: compact ? 13 : 15, fontWeight: '600', color: c.ink }}>{t('comingSoon')}</Text>
      {compact ? null : <Text style={{ fontSize: 13, color: c.secondary, marginTop: 4 }}>{t('comingSoonBody')}</Text>}
    </View>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  const { c } = useV2();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!message) return;
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(2200),
      Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => onDone());
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!message) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 100, left: 24, right: 24, alignItems: 'center', opacity }}>
      <View style={{ backgroundColor: c.ink, borderRadius: RADIUS.pill, paddingHorizontal: 16, paddingVertical: 10 }}>
        <Text style={{ color: c.page, fontSize: 14 }}>{message}</Text>
      </View>
    </Animated.View>
  );
}
