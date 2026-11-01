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
  /** Head height for a face-only close-up. Always contains the ideal headH when the shot has one. */
  headH: Range | null;
  faceH: Range | null;
};

function cover(ideal: Range | null, calibrated: readonly number[] | undefined): Range | null {
  if (!ideal && !calibrated) return null;
  if (!ideal) return asRange(calibrated!);
  if (!calibrated) return ideal;
  return [Math.min(ideal[0], calibrated[0]), Math.max(ideal[1], calibrated[1])];
}

type ToleranceCell = { eyeY?: number[]; headroom?: number[]; subjH?: number[]; faceH?: number[]; footRoom?: number[] };

/** No-nag band. Widened so every ideal range sits inside it. */
export function nagBands(size: ShotSize, aspect: AspectId, idealEye: Range, idealHead: Range | null, idealSubj: Range | null): NagBands {
  const key = shotKey(size);
  const table = portraitTolerance.shots[key] as Record<string, ToleranceCell>;
  const cell = table[aspect] ?? table["4:5"] ?? {};
  const ratios = ratiosFor(size, aspect);
  const idealHeadH = ratios.headH ? asRange(ratios.headH) : null;
  const k = portraitTargets.landmarks.headTopFromFace.faceTopMinusChinToFaceTopRatio;
  const derivedHead = cell.faceH ? [cell.faceH[0] * (1 + k), cell.faceH[1] * (1 + k)] : undefined;
  const lead = portraitTargets.horizontal.leadRoom;
  const frontal = asRange(portraitTargets.horizontal.frontalCenterX);
  const faceIdeal: Range = [Math.min(frontal[0], 0.5 - lead), Math.max(frontal[1], 0.5 + lead)];
  return {
    eyeY: cover(idealEye, cell.eyeY) ?? idealEye,
    headroom: cover(idealHead, cell.headroom),
    faceX: cover(faceIdeal, portraitTolerance.faceX[key]) ?? faceIdeal,
    subjH: cover(idealSubj, cell.subjH),
    headH: cover(idealHeadH, derivedHead),
    faceH: cell.faceH ? asRange(cell.faceH) : null,
  };
}

export type IdealBands = {
  eyeY: Range;
  headroom: Range | null;
  subjH: Range | null;
  headH: Range | null;
  faceX: Range;
};

/** The narrow aim. Callers compare this with `nagBands` and require ideal ⊆ tolerance. */
export function idealBands(size: ShotSize, aspect: AspectId): IdealBands {
  const ratios = ratiosFor(size, aspect);
  const headroom = ratios.headroom ? asRange(ratios.headroom) : null;
  const lead = portraitTargets.horizontal.leadRoom;
  const frontal = asRange(portraitTargets.horizontal.frontalCenterX);
  return {
    eyeY: asRange(ratios.eyeY),
    headroom,
    subjH: subjectHeightRange(size, aspect),
    headH: ratios.headH ? asRange(ratios.headH) : null,
    faceX: [Math.min(frontal[0], 0.5 - lead), Math.max(frontal[1], 0.5 + lead)],
  };
}

export function clampToBand(value: number | undefined, band: Range): number {
  if (value == null || !Number.isFinite(value)) return midpoint(band);
  return Math.min(band[1], Math.max(band[0], value));
}
