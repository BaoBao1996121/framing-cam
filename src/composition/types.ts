export const ASPECTS = {
  "4:5": 4 / 5,
  "3:4": 3 / 4,
  "9:16": 9 / 16,
} as const;

export type AspectId = keyof typeof ASPECTS;

export const ASPECT_IDS = Object.keys(ASPECTS) as AspectId[];

/** Normalized rectangle. Origin is the top-left of the full camera buffer, y grows downward. */
export type Rect = { x: number; y: number; w: number; h: number };

export type Point = { x: number; y: number };

export type GuidanceCode =
  | "searching"
  | "left"
  | "right"
  | "up"
  | "down"
  | "closer"
  | "back"
  | "raiseLeft"
  | "raiseRight"
  | "turnUpright"
  | "steady"
  | "ready";

export type FramingKind = "head" | "chest" | "waist" | "thigh" | "full" | "viewfinder";

export type JointName = "elbow" | "wrist" | "hip" | "knee" | "ankle";

export type Subject = {
  id: string;
  eye: Point;
  /** Estimated top of the hair, not the face-mesh hairline. */
  headTop: number;
  chinY: number;
  headLeft: number;
  headRight: number;
  /**
   * Positive when the nose points to image-right of the eye midpoint.
   * Roughly nose offset divided by the distance between the eyes.
   */
  yaw: number;
  shouldersY: number | null;
  shoulders: Point[];
  joints: { name: JointName; x: number; y: number }[];
  confidence: number;
};

export type LlmSuggestion = {
  box: Rect;
  confidence: number;
  reasoning: string;
};

export type HeadTarget = { cx: number; cy: number; rx: number; ry: number };

export type FramePlan = {
  viewfinder: Rect;
  crop: Rect;
  guidance: GuidanceCode;
  alignment: number;
  ready: boolean;
  framing: FramingKind;
  source: "rules" | "llm";
  llmReasoning: string | null;
  quality: "good" | "ok" | "low";
  zoom: number;
  headTarget: HeadTarget;
  showRefinedCrop: boolean;
};
