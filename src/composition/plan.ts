import {
  EYE_LINE,
  MAX_DIGITAL_ZOOM,
  PAN_TOL,
  ROLL_READY,
  ROLL_SEVERE,
  SCALE_MAX,
  SCALE_MIN,
  VERT_TOL,
  idealHeadFraction,
} from "./constants";
import { clamp, digitalZoom, largestAspectRect, toNorm } from "./geometry";
import { prepareLlmCrop, placementForYaw, rankPortraitCrops } from "./rank";
import { headHeight, selectSubject } from "./subject";
import type { AspectId, FramePlan, GuidanceCode, LlmSuggestion, Rect, Subject } from "./types";

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
};

export type GuidanceSignals = {
  dx: number;
  dy: number;
  panTol: number;
  vertTol: number;
  scale: number;
  roll: number | null;
  steady: boolean;
  severeCloser: boolean;
  severeBack: boolean;
  viewfinder: Rect;
};

export function pickGuidance(signals: GuidanceSignals): GuidanceCode {
  if (signals.roll != null && Math.abs(signals.roll) > 50) return "turnUpright";
  if (signals.severeCloser) return "closer";
  if (signals.severeBack) return "back";
  if (signals.roll != null && Math.abs(signals.roll) >= ROLL_SEVERE) {
    return signals.roll > 0 ? "raiseRight" : "raiseLeft";
  }

  const options: { code: GuidanceCode; mag: number }[] = [];
  const width = Math.max(1e-6, signals.viewfinder.w);
  const height = Math.max(1e-6, signals.viewfinder.h);
  if (signals.dx <= -signals.panTol) options.push({ code: "left", mag: Math.abs(signals.dx) / width });
  if (signals.dx >= signals.panTol) options.push({ code: "right", mag: Math.abs(signals.dx) / width });
  if (signals.dy <= -signals.vertTol) options.push({ code: "up", mag: Math.abs(signals.dy) / height });
  if (signals.dy >= signals.vertTol) options.push({ code: "down", mag: Math.abs(signals.dy) / height });
  if (signals.scale < SCALE_MIN) options.push({ code: "closer", mag: (SCALE_MIN - signals.scale) / SCALE_MIN });
  if (signals.scale > SCALE_MAX) options.push({ code: "back", mag: (signals.scale - SCALE_MAX) / SCALE_MAX });
  if (signals.roll != null && Math.abs(signals.roll) >= ROLL_READY) {
    options.push({
      code: signals.roll > 0 ? "raiseRight" : "raiseLeft",
      mag: Math.min(1, Math.abs(signals.roll) / 14),
    });
  }
  options.sort((a, b) => b.mag - a.mag);
  if (!options.length || options[0].mag < 0.012) return signals.steady ? "ready" : "steady";
  return options[0].code;
}

export function mirrorGuidance(code: GuidanceCode): GuidanceCode {
  if (code === "left") return "right";
  if (code === "right") return "left";
  return code;
}

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
    headTarget: {
      cx: viewfinder.x + viewfinder.w / 2,
      cy: viewfinder.y + viewfinder.h * EYE_LINE,
      rx: viewfinder.w * 0.12,
      ry: viewfinder.h * 0.1,
    },
    showRefinedCrop: false,
  };
}

export function planFrame(input: PlanInput): FramePlan {
  const maxZoom = input.maxDigitalZoom ?? MAX_DIGITAL_ZOOM;
  const viewfinder = toNorm(
    largestAspectRect(input.imageWidth, input.imageHeight, aspectValue(input.aspect)),
    input.imageWidth,
    input.imageHeight,
  );
  const subject = selectSubject(input.subjects, input.selectedId);
  if (!subject) return emptyPlan(viewfinder);

  const ranked = rankPortraitCrops(subject, input.imageWidth, input.imageHeight, input.aspect, maxZoom);
  let crop = ranked.rect;
  let framing = ranked.framing;
  let source: FramePlan["source"] = "rules";
  let llmReasoning: string | null = null;
  if (input.llm && input.llm.confidence >= 0.35) {
    const adopted = prepareLlmCrop(input.llm.box, subject, input.imageWidth, input.imageHeight, input.aspect, maxZoom);
    if (adopted) {
      crop = adopted;
      framing = ranked.framing;
      source = "llm";
      llmReasoning = input.llm.reasoning;
    }
  }

  const height = headHeight(subject);
  const scale = height / viewfinder.h / idealHeadFraction(input.aspect);
  const idealEyeX = viewfinder.x + viewfinder.w * placementForYaw(subject.yaw);
  const idealEyeY = viewfinder.y + viewfinder.h * EYE_LINE;
  let dy = subject.eye.y - idealEyeY;
  if (subject.headTop < viewfinder.y + viewfinder.h * 0.025) dy = Math.min(dy, -viewfinder.h * VERT_TOL);
  const dx = subject.eye.x - idealEyeX;
  const headPx = height * input.imageHeight;
  const severeCloser = scale < 0.75 || headPx < 170;
  const severeBack = scale > 1.32;
  const signals: GuidanceSignals = {
    dx,
    dy,
    panTol: viewfinder.w * PAN_TOL,
    vertTol: viewfinder.h * VERT_TOL,
    scale,
    roll: input.rollDeg,
    steady: input.steady,
    severeCloser,
    severeBack,
    viewfinder,
  };
  const rawGuidance = pickGuidance(signals);
  const panScore = 1 - clamp(Math.abs(dx) / (signals.panTol * 3.2), 0, 1);
  const vertScore = 1 - clamp(Math.abs(dy) / (signals.vertTol * 3.2), 0, 1);
  const scaleScore = 1 - clamp(Math.abs(Math.log(Math.max(scale, 0.05))) / Math.log(1.7), 0, 1);
  const rollScore = input.rollDeg == null ? 1 : 1 - clamp(Math.abs(input.rollDeg) / 12, 0, 1);
  const alignment = clamp(0.3 * panScore + 0.3 * vertScore + 0.25 * scaleScore + 0.15 * rollScore, 0, 1);
  const zoom = digitalZoom(crop, viewfinder);
  let quality: FramePlan["quality"] = "good";
  if (zoom > 1.32 || headPx < 240 || scale < 0.9) quality = "ok";
  if (zoom > maxZoom * 0.98 || headPx < 170 || scale < 0.75) quality = "low";
  const desiredHead = idealHeadFraction(input.aspect) * viewfinder.h;
  const showRefinedCrop =
    rawGuidance === "ready" ||
    rawGuidance === "steady" ||
    (Math.abs(dx) < signals.panTol * 1.8 &&
      Math.abs(dy) < signals.vertTol * 1.8 &&
      scale > 0.82 &&
      scale < 1.22 &&
      (input.rollDeg == null || Math.abs(input.rollDeg) < 5));

  return {
    viewfinder,
    crop,
    guidance: input.mirror ? mirrorGuidance(rawGuidance) : rawGuidance,
    alignment,
    ready: rawGuidance === "ready",
    framing: source === "llm" ? framing : ranked.framing,
    source,
    llmReasoning,
    quality,
    zoom,
    headTarget: {
      cx: idealEyeX,
      cy: idealEyeY - desiredHead * 0.06,
      rx: (desiredHead * input.imageHeight * 0.4) / input.imageWidth,
      ry: desiredHead * 0.52,
    },
    showRefinedCrop,
  };
}

function aspectValue(aspect: AspectId): number {
  if (aspect === "9:16") return 9 / 16;
  if (aspect === "3:4") return 3 / 4;
  return 4 / 5;
}
