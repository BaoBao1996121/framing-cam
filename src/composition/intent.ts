/** What the photographer wants. Coordinates are solved from portrait-targets.json, never taken from the model. */
export type ShotSize = "close" | "medium" | "three-quarter" | "full" | "wide";

export type CompositionIntent = {
  shotSize: ShotSize;
  /** Chosen inside the spec eyeY range. */
  eyeLine: number;
  /** Chosen inside the spec horizontal band. */
  horizontal: number;
  /** Chosen inside the spec headroom range when that shot has one. */
  headroom: number;
  title: string;
  styleTag: string;
  poseTip: string;
  confidence: number;
};

export function normalizeShotSize(value: string): ShotSize {
  if (value === "environmental" || value === "environment") return "wide";
  if (value === "half" || value === "half-body") return "medium";
  if (value === "close" || value === "medium" || value === "three-quarter" || value === "full" || value === "wide") return value;
  return "medium";
}

export { measureExtent, classifyShot } from "./measure";
export { guidanceBox, placementFor, resolveTarget, frameCrop, DEFAULT_FRAME } from "./solve";
export type { FrameSize, ResolvedTarget } from "./solve";
