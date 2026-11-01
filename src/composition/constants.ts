import type { AspectId } from "./types";

/** Eyes sit just above the upper third, which reads naturally in a vertical portrait. */
export const EYE_LINE = 0.34;

/** Share of the crop above the estimated top of the hair. */
export const IDEAL_HEADROOM = 0.14;

/**
 * How much tighter than the largest on-sensor frame of this aspect we will crop.
 * Beyond this, the holder should step closer so the sensor, not interpolation, does the zoom.
 */
export const MAX_DIGITAL_ZOOM = 1.65;

export const PAN_TOL = 0.05;
export const VERT_TOL = 0.05;
export const SCALE_MIN = 0.86;
export const SCALE_MAX = 1.18;
export const ROLL_READY = 3;
export const ROLL_SEVERE = 6.5;

export function idealHeadFraction(aspect: AspectId): number {
  if (aspect === "9:16") return 0.22;
  if (aspect === "3:4") return 0.28;
  return 0.3;
}
