import React, { useMemo } from 'react';
import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { Zone } from '../data/types';
import { circlePolygon } from './status';

/** Zone circles as one GeoJSON source: active zones blue, pending zones dashed gray. */
export function ZoneCircles({ zones, highlightId }: { zones: Zone[]; highlightId?: string | null }) {
  const data = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: zones.map(z => ({
      type: 'Feature' as const,
      properties: { id: z.id, state: z.state, highlight: z.id === highlightId ? 1 : 0 },
      geometry: { type: 'Polygon' as const, coordinates: [circlePolygon(z.center, z.radiusM)] },
    })),
  }), [zones, highlightId]);
  return (
    <GeoJSONSource id="zones" data={data}>
      <Layer
        id="zones-fill"
        type="fill"
        paint={{
          'fill-color': ['match', ['get', 'state'], 'active', '#2F7CF6', '#A0AAB4'],
          'fill-opacity': ['case', ['==', ['get', 'highlight'], 1], 0.22, 0.12],
        }}
      />
      <Layer
        id="zones-line"
        type="line"
        paint={{
          'line-color': ['match', ['get', 'state'], 'active', '#2F7CF6', '#A0AAB4'],
          'line-width': 1.5,
        }}
      />
    </GeoJSONSource>
  );
}
