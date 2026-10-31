import React from 'react';
import { View } from 'react-native';

export type IconName = 'friends' | 'places' | 'me' | 'locate' | 'plus' | 'close' | 'route' | 'bell' | 'wave' | 'lock' | 'chevron';

/** Minimal line icons drawn with Views (no icon font / native dependency). */
export function Icon({ name, color, size = 22 }: { name: IconName; color: string; size?: number }) {
  const u = size / 22;
  const ring = (d: number, w = 1.8 * u) => ({ width: d, height: d, borderRadius: d / 2, borderWidth: w, borderColor: color });
  const box = { width: size, height: size, alignItems: 'center' as const, justifyContent: 'center' as const };
  switch (name) {
    case 'friends':
      return (
        <View style={box}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
            <View style={{ alignItems: 'center', marginRight: -2 * u }}>
              <View style={ring(7 * u)} /><View style={{ width: 11 * u, height: 6 * u, borderTopLeftRadius: 6 * u, borderTopRightRadius: 6 * u, borderWidth: 1.8 * u, borderBottomWidth: 0, borderColor: color, marginTop: 1 * u }} />
            </View>
            <View style={{ alignItems: 'center' }}>
              <View style={ring(8 * u)} /><View style={{ width: 13 * u, height: 7 * u, borderTopLeftRadius: 7 * u, borderTopRightRadius: 7 * u, borderWidth: 1.8 * u, borderBottomWidth: 0, borderColor: color, marginTop: 1 * u }} />
            </View>
          </View>
        </View>
      );
    case 'me':
      return (
        <View style={box}>
          <View style={ring(8 * u)} />
          <View style={{ width: 14 * u, height: 7 * u, borderTopLeftRadius: 7 * u, borderTopRightRadius: 7 * u, borderWidth: 1.8 * u, borderBottomWidth: 0, borderColor: color, marginTop: 1.5 * u }} />
        </View>
      );
    case 'places':
      return (
        <View style={box}>
          <View style={[ring(14 * u), { alignItems: 'center', justifyContent: 'center' }]}>
            <View style={{ width: 4 * u, height: 4 * u, borderRadius: 2 * u, backgroundColor: color }} />
          </View>
        </View>
      );
    case 'locate':
      return (
        <View style={box}>
          <View style={[ring(14 * u), { alignItems: 'center', justifyContent: 'center' }]}>
            <View style={{ width: 5 * u, height: 5 * u, borderRadius: 2.5 * u, backgroundColor: color }} />
          </View>
          <View style={{ position: 'absolute', width: 1.8 * u, height: size, backgroundColor: color, opacity: 0.35 }} />
          <View style={{ position: 'absolute', height: 1.8 * u, width: size, backgroundColor: color, opacity: 0.35 }} />
        </View>
      );
    case 'plus':
    case 'close': {
      const rot = name === 'close' ? '45deg' : '0deg';
      return (
        <View style={[box, { transform: [{ rotate: rot }] }]}>
          <View style={{ position: 'absolute', width: 2 * u, height: 14 * u, borderRadius: u, backgroundColor: color }} />
          <View style={{ position: 'absolute', height: 2 * u, width: 14 * u, borderRadius: u, backgroundColor: color }} />
        </View>
      );
    }
    case 'route':
      return (
        <View style={box}>
          <View style={{ width: 12 * u, height: 12 * u, borderLeftWidth: 1.8 * u, borderTopWidth: 1.8 * u, borderColor: color, transform: [{ rotate: '45deg' }], marginLeft: 4 * u }} />
        </View>
      );
    case 'bell':
      return (
        <View style={box}>
          <View style={{ width: 13 * u, height: 12 * u, borderTopLeftRadius: 7 * u, borderTopRightRadius: 7 * u, borderWidth: 1.8 * u, borderBottomWidth: 0, borderColor: color }} />
          <View style={{ width: 17 * u, height: 1.8 * u, backgroundColor: color }} />
          <View style={{ width: 4 * u, height: 2.5 * u, borderBottomLeftRadius: 2 * u, borderBottomRightRadius: 2 * u, backgroundColor: color, marginTop: 1 * u }} />
        </View>
      );
    case 'wave':
      return (
        <View style={box}>
          {[0, 1, 2].map(i => (
            <View key={i} style={{ position: 'absolute', width: (6 + i * 5) * u, height: (6 + i * 5) * u, borderRadius: 20 * u, borderWidth: 1.8 * u, borderColor: color, borderLeftColor: 'transparent', borderBottomColor: 'transparent', transform: [{ rotate: '45deg' }], opacity: 1 - i * 0.25 }} />
          ))}
        </View>
      );
    case 'lock':
      return (
        <View style={box}>
          <View style={{ width: 9 * u, height: 7 * u, borderTopLeftRadius: 5 * u, borderTopRightRadius: 5 * u, borderWidth: 1.8 * u, borderBottomWidth: 0, borderColor: color }} />
          <View style={{ width: 13 * u, height: 9 * u, borderRadius: 2 * u, backgroundColor: color }} />
        </View>
      );
    case 'chevron':
      return (
        <View style={box}>
          <View style={{ width: 8 * u, height: 8 * u, borderRightWidth: 1.8 * u, borderTopWidth: 1.8 * u, borderColor: color, transform: [{ rotate: '45deg' }] }} />
        </View>
      );
  }
}
