import React, { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useV2 } from '../i18n';
import { RADIUS } from '../theme';

/** Translucent floating card ("frosted" look without a native blur dependency). */
export function GlassCard({ children, style, strong }: { children: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean }) {
  const { c } = useV2();
  return (
    <View style={[{
      backgroundColor: strong ? c.glassStrong : c.glass,
      borderColor: c.glassBorder, borderWidth: 0.5, borderRadius: RADIUS.card,
      shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3,
    }, style]}>
      {children}
    </View>
  );
}
