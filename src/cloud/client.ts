import type { LlmSuggestion, Rect, Subject } from "../composition/types";
import type { ShotPlan } from "../plans/types";

/** Pages builds leave this unset so they never request a missing /api. Netlify sets VITE_CLOUD=1. */
export function shouldProbeCloud(isDev: boolean, cloudFlag: string | undefined): boolean {
  return isDev || cloudFlag === "1";
}

function apiUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(path.replace(/^\//, ""), new URL(base, "http://local")).pathname;
}

export async function cloudAvailable(): Promise<boolean> {
  // Written inline so a Pages build (no VITE_CLOUD) drops the fetch entirely.
  if (!(import.meta.env.DEV || import.meta.env.VITE_CLOUD === "1")) return false;
  try {
    const response = await fetch(apiUrl("api/health"));
    if (!response.ok) return false;
    const body = (await response.json()) as { llm?: boolean };
    return Boolean(body.llm);
  } catch {
    return false;
  }
}

export function subjectSummary(subject: Subject | null): Record<string, unknown> | null {
  if (!subject) return null;
  return {
    eyeX: round(subject.eye.x),
    eyeY: round(subject.eye.y),
    headTop: round(subject.headTop),
    chinY: round(subject.chinY),
    yaw: round(subject.yaw),
    shouldersY: subject.shouldersY == null ? null : round(subject.shouldersY),
    joints: subject.joints.map((joint) => ({ name: joint.name, x: round(joint.x), y: round(joint.y) })),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export async function requestShotPlans(input: {
  imageDataUrl: string;
  aspect: string;
  imageWidth: number;
  imageHeight: number;
  locale: string;
  style: string;
  rollDeg: number | null;
  zoom: { min: number; max: number; current: number };
  subject: Record<string, unknown> | null;
}): Promise<ShotPlan[] | null> {
  if (!(import.meta.env.DEV || import.meta.env.VITE_CLOUD === "1")) return null;
  try {
    const response = await fetch(apiUrl("api/frame"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean; plans?: ShotPlan[] };
    if (!body.ok || !body.plans || body.plans.length < 2) return null;
    return body.plans.slice(0, 4);
  } catch {
    return null;
  }
}

export async function requestCloudCrop(input: {
  imageDataUrl: string;
  aspect: string;
  imageWidth: number;
  imageHeight: number;
  locale: string;
  subject: Subject | null;
  rulesBox: Rect;
}): Promise<LlmSuggestion | null> {
  if (!(import.meta.env.DEV || import.meta.env.VITE_CLOUD === "1")) return null;
  const response = await fetch(apiUrl("api/frame"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      imageDataUrl: input.imageDataUrl,
      aspect: input.aspect,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
      locale: input.locale,
      subject: subjectSummary(input.subject),
      rulesBox: input.rulesBox,
    }),
  });
  if (!response.ok) return null;
  let body: { ok?: boolean; framing?: { box: Rect; confidence?: number; reasoning?: string } };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return null;
  }
  if (!body.ok || !body.framing?.box) return null;
  return {
    box: body.framing.box,
    confidence: body.framing.confidence ?? 0.5,
    reasoning: body.framing.reasoning ?? "",
  };
}
