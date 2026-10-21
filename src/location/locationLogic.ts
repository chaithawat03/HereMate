/** Validate and round an on-device GPS fix without persisting or sharing it. */
export type LocalSample = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  measuredAt: number;
};
export function toLocalSample(value: {
  timestamp: number;
  coords: { latitude: number; longitude: number; accuracy?: number | null };
}): LocalSample | null {
  const { latitude, longitude, accuracy } = value.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 ||
      !Number.isFinite(value.timestamp) || value.timestamp <= 0) return null;
  return {
    latitude: Math.round(latitude * 1000000) / 1000000,
    longitude: Math.round(longitude * 1000000) / 1000000,
    accuracyMeters: typeof accuracy === 'number' && Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy) : null,
    measuredAt: value.timestamp,
  };
}
