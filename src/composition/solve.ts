import { clamp, largestAspectRect, toNorm } from "./geometry";
import { ASPECTS, type AspectId, type Rect } from "./types";
import type { ShotSize } from "./intent";
import {
  asRange,
  clampToBand,
  horizontalBand,
  midpoint,
  portraitTargets,
  ratiosFor,
  subjectHeightRange,
  type PortraitTargets,
  type Range,
} from "./targets";

export type FrameSize = { width: number; height: number; aspect: AspectId };

export const DEFAULT_FRAME: FrameSize = { width: 480, height: 640, aspect: "4:5" };

export type ResolvedTarget = {
  shotSize: ShotSize;
  aspect: AspectId;
  eyeY: number;
  eyeYRange: Range;
  headroom: number;
  headroomRange: Range | null;
  horizontal: number;
  horizontalRange: Range;
  headHRange: Range | null;
  subjHRange: Range | null;
  footRoomRange: Range | null;
};

export function resolveTarget(
  input: { shotSize: ShotSize; eyeLine?: number; headroom?: number; horizontal?: number; yaw?: number },
  aspect: AspectId,
  config: PortraitTargets = portraitTargets,
): ResolvedTarget {
  const ratios = ratiosFor(input.shotSize, aspect, config);
  const eyeYRange = asRange(ratios.eyeY);
  const headroomRange = ratios.headroom ? asRange(ratios.headroom) : null;
  const horizontalRange = horizontalBand(input.yaw ?? 0, input.shotSize, config);
  return {
    shotSize: input.shotSize,
    aspect,
    eyeY: clampToBand(input.eyeLine, eyeYRange),
    eyeYRange,
    headroom: headroomRange ? clampToBand(input.headroom, headroomRange) : midpoint(eyeYRange) * 0.4,
    headroomRange,
    horizontal: clampToBand(input.horizontal, horizontalRange),
    horizontalRange,
    headHRange: ratios.headH ? asRange(ratios.headH) : null,
    subjHRange: subjectHeightRange(input.shotSize, aspect, config),
    footRoomRange: ratios.footRoom ? asRange(ratios.footRoom) : null,
  };
}

export function frameCrop(frame: FrameSize): Rect {
  const aspect = ASPECTS[frame.aspect];
  return toNorm(largestAspectRect(frame.width, frame.height, aspect), frame.width, frame.height);
}

/** Subject box inside the aspect crop. One placement for the ghost and the saved crop. */
export function placementFor(
  target: ResolvedTarget,
  frame: FrameSize,
  config: PortraitTargets = portraitTargets,
): { crop: Rect; subjectBox: Rect } {
  const crop = frameCrop(frame);
  const top = crop.y + target.headroom * crop.h;
  let height = crop.h * 0.5;
  if (target.shotSize === "close" && target.headHRange) height = midpoint(target.headHRange) * crop.h;
  else if (target.subjHRange) height = midpoint(target.subjHRange) * crop.h;
  else height = Math.max(0.08, crop.y + crop.h - top);
  height = Math.min(height, 1 - top);
  const margin = config.horizontal.sideMarginMin;
  const center = crop.x + target.horizontal * crop.w;
  const width = clamp(height * (frame.height / Math.max(1, frame.width)) * 0.85, 0.12, Math.max(0.12, crop.w - margin * 2));
  const x = clamp(center - width / 2, 0, Math.max(0, 1 - width));
  const y = clamp(top, 0, Math.max(0, 1 - height));
  return { crop, subjectBox: { x, y, w: width, h: height } };
}

export function guidanceBox(
  intent: { shotSize: ShotSize; eyeLine?: number; horizontal?: number; headroom?: number; yaw?: number },
  frame: FrameSize = DEFAULT_FRAME,
  config: PortraitTargets = portraitTargets,
): Rect {
  return placementFor(resolveTarget(intent, frame.aspect, config), frame, config).subjectBox;
}
