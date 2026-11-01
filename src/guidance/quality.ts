import { clamp } from "../composition/geometry";
import type { Rect } from "../composition/types";

export type QualityWarning = "blur" | "tilt" | "horizon" | "dark" | "bright";

export function smoothScore(previous: number | null, next: number, alpha = 0.28): number {
  if (previous == null) return next;
  return previous + (next - previous) * alpha;
}

/** 0–1 on-device score used when no model plan is available. */
export function compositionScore(input: {
  subject: Rect | null;
  luminance: number | null;
  rollDeg: number | null;
}): { score: number; warnings: QualityWarning[] } {
  const warnings: QualityWarning[] = [];
  if (input.rollDeg != null && Math.abs(input.rollDeg) > 3.5 && Math.abs(input.rollDeg) < 50) {
    warnings.push(Math.abs(input.rollDeg) > 8 ? "tilt" : "horizon");
  }
  if (input.luminance != null && input.luminance < 0.22) warnings.push("dark");
  if (input.luminance != null && input.luminance > 0.9) warnings.push("bright");

  if (!input.subject) return { score: 0.2, warnings };
  const cx = input.subject.x + input.subject.w / 2;
  const cy = input.subject.y + input.subject.h / 2;
  const thirds = 1 - clamp(Math.min(Math.abs(cx - 0.33), Math.abs(cx - 0.5), Math.abs(cx - 0.67)) / 0.2, 0, 1);
  const eyeLine = 1 - clamp(Math.abs(cy - 0.36) / 0.28, 0, 1);
  const faceRatio = 1 - clamp(Math.abs(input.subject.h - 0.34) / 0.34, 0, 1);
  const symmetry = 1 - clamp(Math.abs(cx - 0.5) / 0.5, 0, 1);
  let light = 0.7;
  if (input.luminance != null) light = 1 - clamp(Math.abs(input.luminance - 0.55) / 0.45, 0, 1);
  const score = clamp(0.3 * thirds + 0.28 * eyeLine + 0.22 * faceRatio + 0.1 * symmetry + 0.1 * light, 0, 1);
  return { score, warnings };
}

export function meanLuminance(pixels: Uint8ClampedArray): number {
  if (pixels.length < 4) return 0;
  let sum = 0;
  let count = 0;
  for (let index = 0; index < pixels.length; index += 16) {
    sum += pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
    count += 1;
  }
  return count ? sum / count / 255 : 0;
}
