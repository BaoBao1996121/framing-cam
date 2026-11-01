import { DEFAULT_FRAME, guidanceBox, normalizeShotSize, resolveTarget } from "../composition/intent";
import { clamp } from "../composition/geometry";
import { extractJson } from "../composition/llm";
import { fallbackPlans } from "./fallback";
import type { PlanContext, ShotPlan } from "./types";

const SHOT_SIZES = new Set(["close", "medium", "three-quarter", "full", "wide", "environmental"]);

function text(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, max);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function repairOne(value: unknown, index: number, context: PlanContext): ShotPlan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const shotSize = text(raw.shotSize, 24, "");
  if (!SHOT_SIZES.has(shotSize)) return null;
  const size = normalizeShotSize(shotSize);
  const aspect = context.aspect ?? DEFAULT_FRAME.aspect;
  const solved = resolveTarget({ shotSize: size, eyeLine: num(raw.eyeLine) ?? undefined, horizontal: num(raw.horizontal) ?? undefined, headroom: num(raw.headroom) ?? undefined }, aspect);
  const advice = raw.cameraAdvice && typeof raw.cameraAdvice === "object" ? (raw.cameraAdvice as Record<string, unknown>) : {};
  const styleTag = text(raw.styleTag, 24, context.style || "自然");
  return {
    title: text(raw.title, 32, styleTag || `方案 ${index + 1}`),
    styleTag,
    shotSize,
    eyeLine: solved.eyeY,
    horizontal: solved.horizontal,
    headroom: solved.headroom,
    targetBox: guidanceBox(
      { shotSize: size, eyeLine: solved.eyeY, horizontal: solved.horizontal, headroom: solved.headroom },
      {
        width: context.imageWidth ?? DEFAULT_FRAME.width,
        height: context.imageHeight ?? DEFAULT_FRAME.height,
        aspect: context.aspect ?? DEFAULT_FRAME.aspect,
      },
    ),
    cameraAdvice: {
      height: text(advice.height, 40, "与眼平"),
      tilt: text(advice.tilt, 40, "保持水平"),
      distance: text(advice.distance, 40, "保持距离"),
    },
    zoom: clamp(num(raw.zoom) ?? 1, 1, 1.6),
    poseTip: text(raw.poseTip, 48, "放松肩膀"),
    holderDirection: text(raw.holderDirection, 48, "把人物放进框里"),
    confidence: clamp(num(raw.confidence) ?? 0.5, 0, 1),
  };
}

function listFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.plans)) return record.plans;
  if (typeof record.shotSize === "string") return [record];
  return [];
}

/** Turn model JSON into 2–4 usable plans. Coordinates in the reply are ignored. */
export function repairPlans(value: unknown, context: PlanContext): ShotPlan[] {
  const repaired = listFrom(value)
    .map((item, index) => repairOne(item, index, context))
    .filter((item): item is ShotPlan => item != null);
  const extras = fallbackPlans(context.style, context.subjectBox);
  const merged: ShotPlan[] = [];
  for (const plan of [...repaired, ...extras]) {
    if (merged.length >= 4) break;
    if (merged.some((item) => item.title === plan.title && item.shotSize === plan.shotSize)) continue;
    merged.push(plan);
  }
  return merged.slice(0, 4);
}

export function repairPlansFromText(text: string, context: PlanContext): ShotPlan[] {
  try {
    return repairPlans(extractJson(text), context);
  } catch {
    return repairPlans(null, context);
  }
}
