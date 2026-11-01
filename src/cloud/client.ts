import type { LlmSuggestion, Rect, Subject } from "../composition/types";

export async function cloudAvailable(): Promise<boolean> {
  // The GitHub Pages build has no API. Skip the request so a 404 never shows up.
  if (!import.meta.env.DEV) return false;
  try {
    const response = await fetch("/api/health");
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

export async function requestCloudCrop(input: {
  imageDataUrl: string;
  aspect: string;
  imageWidth: number;
  imageHeight: number;
  locale: string;
  subject: Subject | null;
  rulesBox: Rect;
}): Promise<LlmSuggestion | null> {
  if (!import.meta.env.DEV) return null;
  const response = await fetch("/api/frame", {
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
