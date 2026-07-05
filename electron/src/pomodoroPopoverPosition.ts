export interface RectLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

const POPOVER_GAP = 6;
const SCREEN_MARGIN = 8;
const FALLBACK_MARGIN = 16;

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.max(min, Math.min(value, max));
}

export function hasUsableBounds(bounds: RectLike | null | undefined): bounds is RectLike {
  return !!bounds && bounds.width > 0 && bounds.height > 0;
}

export function computeAnchoredPopoverPosition(
  winBounds: RectLike,
  anchorBounds: RectLike,
  workArea: RectLike
): { x: number; y: number } {
  const minX = workArea.x + SCREEN_MARGIN;
  const maxX = workArea.x + workArea.width - winBounds.width - SCREEN_MARGIN;
  const minY = workArea.y + SCREEN_MARGIN;
  const maxY = workArea.y + workArea.height - winBounds.height - SCREEN_MARGIN;

  const centeredX = Math.round(anchorBounds.x + anchorBounds.width / 2 - winBounds.width / 2);
  const belowAnchorY = Math.round(anchorBounds.y + anchorBounds.height + POPOVER_GAP);

  return {
    x: clamp(centeredX, minX, maxX),
    y: clamp(belowAnchorY, minY, maxY),
  };
}

export function computeFallbackPopoverPosition(
  winBounds: RectLike,
  workArea: RectLike
): { x: number; y: number } {
  return {
    x: workArea.x + workArea.width - winBounds.width - FALLBACK_MARGIN,
    y: workArea.y + FALLBACK_MARGIN,
  };
}
