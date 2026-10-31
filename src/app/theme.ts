// Premium Minimal tokens (spec §3). Status colors are identical in both themes.
export type V2Theme = 'light' | 'dark';

const shared = {
  accent: '#2F7CF6', live: '#2FB57C', stale: '#C9A34A', off: '#A0AAB4', danger: '#D64545', me: '#2F7CF6',
};

const PALETTES = {
  light: {
    ...shared,
    ink: '#1D2228', secondary: '#6B7680', mapBase: '#EEF1F4',
    glass: 'rgba(255,255,255,0.92)', glassStrong: 'rgba(255,255,255,0.97)', glassBorder: 'rgba(0,0,0,0.08)',
    tile: '#F3F5F7', divider: '#ECEEF0', handle: '#D3D7DB', page: '#F3F5F7', card: '#FFFFFF',
    onAccent: '#FFFFFF', toggleOff: '#D3D7DB', statusBar: 'dark-content' as const,
  },
  dark: {
    ...shared,
    ink: '#EEF2F6', secondary: '#9AA6B2', mapBase: '#121A24',
    glass: 'rgba(22,30,40,0.90)', glassStrong: 'rgba(22,30,40,0.96)', glassBorder: 'rgba(255,255,255,0.10)',
    tile: '#1E2935', divider: '#26323F', handle: '#3A4654', page: '#0E151D', card: '#18212C',
    onAccent: '#FFFFFF', toggleOff: '#3A4654', statusBar: 'light-content' as const,
  },
};

export type V2Palette = typeof PALETTES.light | typeof PALETTES.dark;
export function palette(theme: V2Theme): V2Palette { return PALETTES[theme]; }

export const RADIUS = { sheet: 22, card: 16, tile: 12, pill: 999 };
export const AVATAR_TINTS = [
  { bg: '#F4E4D7', fg: '#7A4A2A' }, { bg: '#DDE5F3', fg: '#2C4778' }, { bg: '#E7E1F1', fg: '#4B3A72' },
  { bg: '#DDEFE6', fg: '#235B42' }, { bg: '#F6E1E6', fg: '#7A2E42' }, { bg: '#E3ECEF', fg: '#2F4E58' },
];
export function avatarTint(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
