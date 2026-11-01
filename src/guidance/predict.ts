import { clamp } from "../composition/geometry";
import type { Rect } from "../composition/types";

/** Shift the measured box a little using orientation rate since the last landmark frame. Clamped. */
export function predictRect(rect: Rect, gammaPerSec: number, sinceMs: number): Rect {
  if (!Number.isFinite(gammaPerSec) || !Number.isFinite(sinceMs) || sinceMs <= 0) return rect;
  const seconds = Math.min(0.12, sinceMs / 1000);
  const shift = clamp((gammaPerSec * seconds) / 80, -0.02, 0.02);
  const x = clamp(rect.x + shift, 0, Math.max(0, 1 - rect.w));
  return { ...rect, x };
}
