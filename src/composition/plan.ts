import { SpecGuide } from "../guidance/spec-guide";
import { digitalZoom } from "./geometry";
import { classifyShot } from "./measure";
import { cropAroundSubject, frameCrop } from "./solve";
import { selectSubject } from "./subject";
import type { AspectId, FramePlan, GuidanceCode, LlmSuggestion, Rect, Subject } from "./types";
import { normalizeShotSize, type ShotSize } from "./intent";

export type PlanInput = {
  imageWidth: number;
  imageHeight: number;
  subjects: Subject[];
  selectedId: string | null;
  aspect: AspectId;
  rollDeg: number | null;
  steady: boolean;
  mirror?: boolean;
  maxDigitalZoom?: number;
  llm?: LlmSuggestion | null;
  shotSize?: string;
};

export type GuidanceMemory = { shown: GuidanceCode; pending: GuidanceCode; count: number };

export function stabilizeGuidance(memory: GuidanceMemory | null, next: GuidanceCode): { memory: GuidanceMemory; code: GuidanceCode } {
  if (!memory || next === memory.shown || next === "ready" || next === "searching") {
    return { memory: { shown: next, pending: next, count: 0 }, code: next };
  }
  const count = next === memory.pending ? memory.count + 1 : 1;
  if (count >= 3) return { memory: { shown: next, pending: next, count }, code: next };
  return { memory: { shown: memory.shown, pending: next, count }, code: memory.shown };
}

function emptyPlan(viewfinder: Rect): FramePlan {
  return {
    viewfinder,
    crop: viewfinder,
    guidance: "searching",
    alignment: 0,
    ready: false,
    framing: "viewfinder",
    source: "rules",
    llmReasoning: null,
    quality: "low",
    zoom: 1,
    headTarget: { cx: viewfinder.x + viewfinder.w / 2, cy: viewfinder.y + viewfinder.h * 0.36, rx: viewfinder.w * 0.12, ry: viewfinder.h * 0.1 },
    showRefinedCrop: false,
  };
}

function framingOf(shot: ShotSize): FramePlan["framing"] {
  if (shot === "close") return "head";
  if (shot === "medium") return "waist";
  if (shot === "three-quarter") return "thigh";
  if (shot === "full" || shot === "wide") return "full";
  return "viewfinder";
}

/** Hints and the saved crop both come from the JSON solver. Left/right are not mirrored. */
export function planFrame(input: PlanInput): FramePlan {
  const frame = { width: input.imageWidth, height: input.imageHeight, aspect: input.aspect };
  const viewfinder = frameCrop(frame);
  const subject = selectSubject(input.subjects, input.selectedId);
  if (!subject || input.imageWidth < 2 || input.imageHeight < 2) return emptyPlan(viewfinder);
  const shot = input.shotSize ? normalizeShotSize(input.shotSize) : classifyShot(subject);
  const crop = cropAroundSubject(subject, shot, frame);
  const step = new SpecGuide().step({
    now: 0,
    subject,
    shotSize: shot,
    frame,
    rollDeg: input.rollDeg,
    steady: input.steady,
    yaw: subject.yaw,
  });
  const guidance: GuidanceCode = step.hint === "hold" ? "steady" : step.hint;
  return {
    viewfinder,
    crop,
    guidance,
    alignment: step.score,
    ready: step.hint === "ready",
    framing: framingOf(shot),
    source: "rules",
    llmReasoning: input.llm?.reasoning ?? null,
    quality: step.hint === "ready" ? "good" : step.complete ? "ok" : "low",
    zoom: digitalZoom(crop, viewfinder),
    headTarget: { cx: subject.eye.x, cy: subject.eye.y, rx: 0.08, ry: 0.08 },
    showRefinedCrop: step.hint === "ready" || step.hint === "hold",
  };
}
