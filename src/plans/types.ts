import type { Rect } from "../composition/types";

export type CameraAdvice = {
  height: string;
  tilt: string;
  distance: string;
};

/** One way to shoot the look the user asked for. targetBox is solved from the fields above it. */
export type ShotPlan = {
  title: string;
  styleTag: string;
  shotSize: string;
  eyeLine: number;
  horizontal: number;
  headroom: number;
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
  imageWidth?: number;
  imageHeight?: number;
  aspect?: "4:5" | "3:4" | "9:16";
};
