import { clamp } from "./geometry";
import type { Rect } from "./types";

const MOVES = new Set(["left", "right", "up", "down", "closer", "back", "tilt_left", "tilt_right", "hold", "none"]);

export type LlmFraming = {
  box: Rect;
  primaryMove: string;
  reasoning: string;
  confidence: number;
};

export function extractJson(text: string): unknown {
  const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no json");
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function coerceFraming(value: unknown): LlmFraming | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const box = record.box;
  if (!box || typeof box !== "object") return null;
  const raw = box as Record<string, unknown>;
  const x = numberOrNull(raw.x);
  const y = numberOrNull(raw.y);
  const w = numberOrNull(raw.w);
  const h = numberOrNull(raw.h);
  if (x == null || y == null || w == null || h == null) return null;
  if (w <= 0.05 || h <= 0.05 || w > 1.2 || h > 1.2) return null;
  let reasoning = typeof record.reasoning === "string" ? record.reasoning.replace(/\s+/g, " ").trim() : "";
  if (reasoning.length > 180) reasoning = reasoning.slice(0, 180);
  const move = typeof record.primaryMove === "string" && MOVES.has(record.primaryMove) ? record.primaryMove : "none";
  return {
    box: { x, y, w, h },
    primaryMove: move,
    reasoning,
    confidence: clamp(numberOrNull(record.confidence) ?? 0.5, 0, 1),
  };
}

export function buildFramingPrompt(input: {
  aspect: string;
  aspectValue: number;
  imageWidth: number;
  imageHeight: number;
  locale: string;
  subject: {
    eyeX: number;
    eyeY: number;
    headTop: number;
    chinY: number;
    yaw: number;
    shouldersY: number | null;
    joints: { name: string; x: number; y: number }[];
  } | null;
  rulesBox: Rect;
}): string {
  const language = input.locale.startsWith("en") ? "English" : "Simplified Chinese";
  return [
    `Requested crop aspect (pixel width/height) = ${input.aspect} = ${input.aspectValue.toFixed(4)}.`,
    `Image size: ${input.imageWidth}x${input.imageHeight}.`,
    `Rules engine box: ${JSON.stringify(input.rulesBox)}.`,
    input.subject
      ? `Detected subject (normalized): ${JSON.stringify(input.subject)}.`
      : "No body landmarks were detected. Infer the person from the image.",
    `Write reasoning in ${language}.`,
    "Return JSON only.",
  ].join("\n");
}
