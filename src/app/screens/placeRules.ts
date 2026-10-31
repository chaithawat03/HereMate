export const RADIUS_MIN_M = 100;
export const RADIUS_MAX_M = 1000;
export const RADIUS_STEP_M = 50;
export const RADIUS_DEFAULT_M = 200;

export function clampRadius(m: number): number {
  if (!Number.isFinite(m)) return RADIUS_DEFAULT_M;
  const stepped = Math.round(m / RADIUS_STEP_M) * RADIUS_STEP_M;
  return Math.min(RADIUS_MAX_M, Math.max(RADIUS_MIN_M, stepped));
}
