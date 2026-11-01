import type { Rect } from "../composition/types";

export type CameraAdvice = {
  height: string;
  tilt: string;
  distance: string;
};

/** One way to shoot the look the user asked for. targetBox is where the subject should sit. */
export type ShotPlan = {
  title: string;
  styleTag: string;
  shotSize: string;
  targetBox: Rect;
  cameraAdvice: CameraAdvice;
  zoom: number;
  poseTip: string;
  holderDirection: string;
  confidence: number;
};

export type PlanContext = {
  style: string;
  locale: string;
  subjectBox: Rect | null;
};
