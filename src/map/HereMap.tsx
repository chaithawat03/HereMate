import React, { type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { Camera, Map } from '@maplibre/maplibre-react-native';
import { mapStyleUrl, type MapTheme } from './styles';

export type HereMapProps = {
  theme: MapTheme;
  center: { lat: number; lng: number };
  zoom?: number;
  children?: ReactNode;
  onPressMap?: () => void;
};

// Full-screen map. OSM/OpenFreeMap attribution stays enabled (licence requirement).
export function HereMap({ theme, center, zoom = 13, children, onPressMap }: HereMapProps) {
  return (
    <Map
      style={StyleSheet.absoluteFill}
      mapStyle={mapStyleUrl(theme)}
      attribution
      logo={false}
      compass={false}
      onPress={onPressMap ? () => onPressMap() : undefined}
    >
      <Camera center={[center.lng, center.lat]} zoom={zoom} duration={400} />
      {children}
    </Map>
  );
}
