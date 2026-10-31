// OpenFreeMap vector styles: free, no API key, OpenStreetMap data.
// Attribution (© OpenStreetMap contributors, OpenFreeMap) must stay visible on the map.
export type MapTheme = 'light' | 'dark';

const STYLES: Record<MapTheme, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

export function mapStyleUrl(theme: MapTheme): string {
  return STYLES[theme];
}
