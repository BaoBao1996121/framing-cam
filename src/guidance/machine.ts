import { clamp } from "../composition/geometry";
import type { Rect } from "../composition/types";

/** One instruction for the person holding the phone. */
export type GuideHint =
  | "searching"
  | "left"
  | "right"
  | "up"
  | "down"
  | "closer"
  | "back"
  | "raiseLeft"
  | "raiseRight"
  | "hold"
  | "ready";

export type GuidePhase = "search" | "distance" | "position" | "aligned";

export type GuideMemory = {
  aligned: boolean;
  shown: GuideHint;
  pending: GuideHint;
  pendingSince: number;
};

export type GuideSample = {
  now: number;
  subject: Rect | null;
  target: Rect | null;
  rollDeg: number | null;
  steady: boolean;
};

export type GuideStep = {
  memory: GuideMemory;
  hint: GuideHint;
  phase: GuidePhase;
  /** 0 is perfect. Above 1 is outside tolerance. Above 1.5 leaves the aligned state. */
  error: number;
  /** 0–1 for the live bar. Higher is closer to the plan. */
  score: number;
  aligned: boolean;
};

export const POSITION_TOLERANCE = 0.08;
export const SIZE_TOLERANCE = 0.15;
export const ALIGN_ENTER = 1;
export const ALIGN_EXIT = 1.5;
export const HINT_HOLD_MS = 300;

export function initialGuide(now = 0): GuideMemory {
  return { aligned: false, shown: "searching", pending: "searching", pendingSince: now };
}

function center(box: Rect): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

export function measure(subject: Rect, target: Rect): { error: number; sizeNorm: number; posNorm: number; move: GuideHint } {
  const from = center(subject);
  const to = center(target);
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const posNorm = Math.hypot(dx, dy) / POSITION_TOLERANCE;
  const ratio = subject.h / Math.max(0.04, target.h);
  const sizeNorm = Math.abs(ratio - 1) / SIZE_TOLERANCE;
  const error = Math.max(sizeNorm, posNorm * 0.85);
  let move: GuideHint = "hold";
  if (sizeNorm >= 1 && sizeNorm >= posNorm * 0.85) {
    move = ratio < 1 ? "closer" : "back";
  } else if (Math.abs(dx) >= POSITION_TOLERANCE || Math.abs(dy) >= POSITION_TOLERANCE) {
    move = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
  }
  return { error, sizeNorm, posNorm, move };
}

function desiredHint(sample: GuideSample, aligned: boolean): { hint: GuideHint; phase: GuidePhase; error: number } {
  if (!sample.subject || !sample.target) return { hint: "searching", phase: "search", error: 2 };
  const reading = measure(sample.subject, sample.target);
  if (reading.sizeNorm >= 1 && reading.sizeNorm >= reading.posNorm * 0.85) {
    return { hint: reading.move, phase: "distance", error: reading.error };
  }
  if (sample.rollDeg != null && Math.abs(sample.rollDeg) > 4.5 && Math.abs(sample.rollDeg) < 50) {
    return {
      hint: sample.rollDeg > 0 ? "raiseRight" : "raiseLeft",
      phase: "position",
      error: reading.error,
    };
  }
  if (aligned && reading.error <= ALIGN_EXIT) {
    return { hint: sample.steady ? "ready" : "hold", phase: "aligned", error: reading.error };
  }
  if (reading.move === "hold") {
    return { hint: sample.steady ? "ready" : "hold", phase: "aligned", error: reading.error };
  }
  return { hint: reading.move, phase: "position", error: reading.error };
}

function stabilize(memory: GuideMemory, hint: GuideHint, now: number): Pick<GuideMemory, "shown" | "pending" | "pendingSince"> {
  if (hint === memory.shown || hint === "searching" || hint === "ready" || memory.shown === "searching") {
    return { shown: hint, pending: hint, pendingSince: now };
  }
  const pendingSince = hint === memory.pending ? memory.pendingSince : now;
  if (now - pendingSince >= HINT_HOLD_MS) return { shown: hint, pending: hint, pendingSince };
  return { shown: memory.shown, pending: hint, pendingSince };
}

export function stepGuide(memory: GuideMemory, sample: GuideSample): GuideStep {
  const preview = desiredHint(sample, memory.aligned);
  let aligned = memory.aligned;
  if (!sample.subject || !sample.target) aligned = false;
  else if (!aligned && preview.error < ALIGN_ENTER) aligned = true;
  else if (aligned && preview.error > ALIGN_EXIT) aligned = false;
  const next = desiredHint(sample, aligned);
  const stable = stabilize(memory, next.hint, sample.now);
  const score = !sample.subject ? 0 : aligned ? Math.max(0.86, clamp(1 - next.error / 2.2, 0, 1)) : clamp(1 - next.error / 2.2, 0, 1);
  return {
    memory: { aligned, ...stable },
    hint: stable.shown,
    phase: next.phase,
    error: next.error,
    score,
    aligned,
  };
}
