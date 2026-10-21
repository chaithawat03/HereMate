/** Pure responsive dimensions; recalculated when a foldable's window changes size. */
export function getResponsiveLayout(width: number, height: number): {
  isExpanded: boolean;
  mapHeight: number;
} {
  const w = Number.isFinite(width) ? Math.max(0, width) : 0;
  const h = Number.isFinite(height) ? Math.max(0, height) : 0;
  const isExpanded = w >= 600;
  const minHeight = isExpanded ? 360 : 300;
  const maxHeight = isExpanded ? 520 : 460;
  const mapHeight = Math.round(Math.min(maxHeight, Math.max(minHeight, h * (isExpanded ? 0.48 : 0.38))));
  return { isExpanded, mapHeight };
}
