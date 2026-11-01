import { EYE_LINE, idealHeadFraction } from "../composition/constants";
import { largestAspectRect, toNorm } from "../composition/geometry";
import type { AspectId, GuidanceCode, Subject } from "../composition/types";
import { ASPECTS } from "../composition/types";

export const DEMO_WIDTH = 1080;
export const DEMO_HEIGHT = 1920;

export type DemoState = {
  eyeX: number;
  eyeY: number;
  headH: number;
  roll: number;
};

export const DEMO_START: DemoState = {
  eyeX: 0.3,
  eyeY: 0.3,
  headH: 0.09,
  roll: 7,
};

export function idealPortraitState(aspect: AspectId, imageWidth = DEMO_WIDTH, imageHeight = DEMO_HEIGHT): DemoState {
  const viewfinder = toNorm(largestAspectRect(imageWidth, imageHeight, ASPECTS[aspect]), imageWidth, imageHeight);
  return {
    eyeX: viewfinder.x + viewfinder.w * 0.5,
    eyeY: viewfinder.y + viewfinder.h * EYE_LINE,
    headH: idealHeadFraction(aspect) * viewfinder.h,
    roll: 0,
  };
}

export function subjectFromDemo(state: DemoState, id = "demo"): Subject {
  const height = state.headH;
  const eyeX = state.eyeX;
  const eyeY = state.eyeY;
  const chinY = eyeY + 0.42 * height;
  const shouldersY = chinY + 0.62 * height;
  const shoulderHalf = 0.95 * height;
  const hipY = shouldersY + 1.25 * height;
  const hipHalf = 0.72 * height;
  const kneeY = hipY + 1.05 * height;
  const ankleY = kneeY + 1.02 * height;
  const elbowY = shouldersY + 0.72 * height;
  const wristY = elbowY + 0.62 * height;
  return {
    id,
    eye: { x: eyeX, y: eyeY },
    headTop: eyeY - 0.58 * height,
    chinY,
    headLeft: eyeX - 0.4 * height,
    headRight: eyeX + 0.4 * height,
    yaw: 0,
    shouldersY,
    shoulders: [
      { x: eyeX - shoulderHalf, y: shouldersY },
      { x: eyeX + shoulderHalf, y: shouldersY },
    ],
    joints: [
      { name: "elbow", x: eyeX - shoulderHalf * 1.12, y: elbowY },
      { name: "elbow", x: eyeX + shoulderHalf * 1.12, y: elbowY },
      { name: "wrist", x: eyeX - shoulderHalf * 1.2, y: wristY },
      { name: "wrist", x: eyeX + shoulderHalf * 1.2, y: wristY },
      { name: "hip", x: eyeX - hipHalf, y: hipY },
      { name: "hip", x: eyeX + hipHalf, y: hipY },
      { name: "knee", x: eyeX - hipHalf * 0.82, y: kneeY },
      { name: "knee", x: eyeX + hipHalf * 0.82, y: kneeY },
      { name: "ankle", x: eyeX - hipHalf * 0.7, y: ankleY },
      { name: "ankle", x: eyeX + hipHalf * 0.7, y: ankleY },
    ],
    confidence: 1,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Move the pictured person the way the frame would move if the holder followed `guidance`. */
export function applyGuidance(state: DemoState, guidance: GuidanceCode, dt: number): DemoState {
  const step = Math.min(0.12, Math.max(0, dt));
  const next = { ...state };
  switch (guidance) {
    case "left":
      next.eyeX += 0.18 * step;
      break;
    case "right":
      next.eyeX -= 0.18 * step;
      break;
    case "up":
      next.eyeY += 0.16 * step;
      break;
    case "down":
      next.eyeY -= 0.16 * step;
      break;
    case "closer":
      next.headH *= 1 + 0.55 * step;
      break;
    case "back":
      next.headH *= 1 - 0.4 * step;
      break;
    case "raiseRight":
      next.roll -= 16 * step;
      break;
    case "raiseLeft":
      next.roll += 16 * step;
      break;
    default:
      break;
  }
  next.eyeX = clamp(next.eyeX, 0.08, 0.92);
  next.eyeY = clamp(next.eyeY, 0.08, 0.82);
  next.headH = clamp(next.headH, 0.05, 0.46);
  next.roll = clamp(next.roll, -30, 30);
  return next;
}
