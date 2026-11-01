import raw from "./portrait-targets.json";
import toleranceRaw from "./portrait-tolerance.json";
import type { AspectId } from "./types";
import type { ShotSize } from "./intent";

/** Runtime copy of docs/portrait-composition-spec.md §7. Proposed numbers are edited here, not in code. */
export const portraitTargets = raw;
export const portraitTolerance = toleranceRaw;

export type PortraitTargets = typeof raw;
export type Range = [number, number];

export type ShotKey = "closeUp" | "halfBody" | "threeQuarter" | "fullBody" | "environment";

export function asRange(value: readonly number[]): Range {
  return [value[0], value[1]];
}

export function midpoint(value: readonly number[]): number {
  return (value[0] + value[1]) / 2;
}

export function shotKey(size: ShotSize): ShotKey {
  if (size === "close") return "closeUp";
  if (size === "medium") return "halfBody";
  if (size === "three-quarter") return "threeQuarter";
  if (size === "full") return "fullBody";
  return "environment";
}

export function ratiosFor(size: ShotSize, aspect: AspectId, config: PortraitTargets = portraitTargets): Record<string, number[]> {
  const shots = config.shots;
  const key = shotKey(size);
  const table = shots[key].ratios as Record<string, Record<string, number[]>>;
  return table[aspect] ?? table["4:5"];
}

/** Half and three-quarter heights follow headroom: subjH ≈ 1 − headroom [D]. */
export function subjectHeightRange(size: ShotSize, aspect: AspectId, config: PortraitTargets = portraitTargets): Range | null {
  const ratios = ratiosFor(size, aspect, config);
  if (ratios.subjH) return asRange(ratios.subjH);
  if (ratios.headH && size === "close") return null;
  if (!ratios.headroom) return null;
  return [1 - ratios.headroom[1], 1 - ratios.headroom[0]];
}

export function horizontalBand(yaw: number, _size: ShotSize, config: PortraitTargets = portraitTargets): Range {
  const horizontal = config.horizontal;
  if (Math.abs(yaw) < horizontal.frontalYawMax) return asRange(horizontal.frontalCenterX);
  const center = yaw > 0 ? 0.5 - horizontal.leadRoom : 0.5 + horizontal.leadRoom;
  return [center, center];
}

export type NagBands = {
  eyeY: Range;
  headroom: Range | null;
  faceX: Range;
  subjH: Range | null;
  /** Chin-to-forehead height, used when the shot has no torso to measure. */
  faceH: Range | null;
};

type ToleranceCell = { eyeY?: number[]; headroom?: number[]; subjH?: number[]; faceH?: number[]; footRoom?: number[] };

/** No-nag band. Falls back to the spec ideal when a calibrated cell is missing. */
export function nagBands(size: ShotSize, aspect: AspectId, idealEye: Range, idealHead: Range | null, idealSubj: Range | null): NagBands {
  const key = shotKey(size);
  const table = portraitTolerance.shots[key] as Record<string, ToleranceCell>;
  const cell = table[aspect] ?? table["4:5"] ?? {};
  const faceX = asRange(portraitTolerance.faceX[key]);
  return {
    eyeY: cell.eyeY ? asRange(cell.eyeY) : idealEye,
    headroom: cell.headroom ? asRange(cell.headroom) : idealHead,
    faceX,
    subjH: cell.subjH ? asRange(cell.subjH) : idealSubj,
    faceH: cell.faceH ? asRange(cell.faceH) : null,
  };
}

export function clampToBand(value: number | undefined, band: Range): number {
  if (value == null || !Number.isFinite(value)) return midpoint(band);
  return Math.min(band[1], Math.max(band[0], value));
}
