import React, { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, View, useWindowDimensions } from 'react-native';
import { useV2 } from '../i18n';
import { RADIUS } from '../theme';

export type Snap = 'peek' | 'half' | 'full';
const FRACTION: Record<Snap, number> = { peek: 0.22, half: 0.5, full: 0.88 };

/** Draggable bottom sheet (Animated + PanResponder, no native deps). */
export function BottomSheet({ snap, onSnap, children, bottomInset = 0 }: {
  snap: Snap; onSnap: (s: Snap) => void; children: ReactNode; bottomInset?: number;
}) {
  const { c } = useV2();
  const { height } = useWindowDimensions();
  const full = height * FRACTION.full;
  const offsetFor = (s: Snap) => full - height * FRACTION[s];
  const y = useRef(new Animated.Value(offsetFor(snap))).current;
  const start = useRef(offsetFor(snap));

  useEffect(() => {
    start.current = offsetFor(snap);
    Animated.spring(y, { toValue: offsetFor(snap), useNativeDriver: true, bounciness: 2 }).start();
  }, [snap, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
    onPanResponderMove: (_e, g) => y.setValue(Math.max(0, Math.min(offsetFor('peek'), start.current + g.dy))),
    onPanResponderRelease: (_e, g) => {
      const pos = start.current + g.dy + g.vy * 120;
      const order: Snap[] = ['full', 'half', 'peek'];
      const best = order.reduce((a, b) => (Math.abs(offsetFor(a) - pos) <= Math.abs(offsetFor(b) - pos) ? a : b));
      start.current = offsetFor(best);
      Animated.spring(y, { toValue: offsetFor(best), useNativeDriver: true, bounciness: 2 }).start();
      onSnap(best);
    },
  }), [height, onSnap]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, height: full,
      transform: [{ translateY: y }],
      backgroundColor: c.glassStrong, borderTopLeftRadius: RADIUS.sheet, borderTopRightRadius: RADIUS.sheet,
      borderColor: c.glassBorder, borderWidth: 0.5,
      shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 16, shadowOffset: { width: 0, height: -2 }, elevation: 8,
      paddingBottom: bottomInset,
    }}>
      <View {...responder.panHandlers} style={{ paddingTop: 8, paddingBottom: 6, alignItems: 'center' }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.handle }} />
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Animated.View>
  );
}
