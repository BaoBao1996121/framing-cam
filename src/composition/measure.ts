import { clamp } from "./geometry";
import type { Rect, Subject } from "./types";
import type { ShotSize } from "./intent";
import { portraitTargets, type PortraitTargets } from "./targets";

function jointY(subject: Subject, name: Subject["joints"][number]["name"]): number | null {
  const found = subject.joints.filter((joint) => joint.name === name && Number.isFinite(joint.y));
  if (!found.length) return null;
  return found.reduce((sum, joint) => sum + joint.y, 0) / found.length;
}

function box(subject: Subject, bottom: number): Rect {
  const xs = [subject.headLeft, subject.headRight, ...subject.shoulders.map((point) => point.x)];
  const x = clamp(Math.min(...xs), 0, 1);
  const right = clamp(Math.max(...xs), 0, 1);
  const y = clamp(subject.headTop, 0, 0.92);
  const h = Math.max(0.08, Math.min(1 - y, bottom - y));
  const w = Math.max(0.08, Math.min(1 - x, right - x));
  return { x, y, w, h };
}

/**
 * Extent for this shot, using the same landmarks the spec names.
 * A full shot without ankles is incomplete: callers must say "back", not "closer".
 */
export function measureExtent(
  subject: Subject,
  shotSize: ShotSize,
  config: PortraitTargets = portraitTargets,
): { rect: Rect; complete: boolean; kind: "face" | "chest" | "body" } {
  const head = Math.max(0.001, subject.chinY - subject.headTop);
  const shoulder = subject.shouldersY;
  const hip = jointY(subject, "hip");
  const knee = jointY(subject, "knee");
  const ankle = jointY(subject, "ankle");
  if (shotSize === "close") {
    const drop = config.cropBands.chest.minDropFracHead * head;
    if (shoulder != null && hip != null && hip - shoulder > drop) {
      const safe = config.cropBands.chest.safe;
      const t = (safe[0] + safe[1]) / 2;
      return { rect: box(subject, shoulder + t * (hip - shoulder)), complete: true, kind: "chest" };
    }
    return { rect: box(subject, subject.chinY), complete: true, kind: "face" };
  }
  if (shotSize === "medium") {
    if (hip == null || shoulder == null) return { rect: box(subject, subject.chinY + head), complete: false, kind: "body" };
    const toward = config.landmarks.waistFromHip.towardShoulder;
    const waist = hip - toward * (hip - shoulder);
    return { rect: box(subject, waist), complete: true, kind: "body" };
  }
  if (shotSize === "three-quarter") {
    if (hip == null || knee == null) return { rect: box(subject, hip ?? subject.chinY + head), complete: false, kind: "body" };
    const preferred = config.cropBands.thigh.preferred;
    const t = (preferred[0] + preferred[1]) / 2;
    return { rect: box(subject, hip + t * (knee - hip)), complete: true, kind: "body" };
  }
  if (ankle == null) return { rect: box(subject, knee ?? hip ?? subject.chinY + head), complete: false, kind: "body" };
  const gap = config.cropBands.belowFeet.minGapBelowFeet;
  return { rect: box(subject, ankle + gap), complete: true, kind: "body" };
}

/** Auto shot from the lowest landmark that is actually visible. */
export function classifyShot(subject: Subject, config: PortraitTargets = portraitTargets): ShotSize {
  const ankle = jointY(subject, "ankle");
  const knee = jointY(subject, "knee");
  const hip = jointY(subject, "hip");
  const head = Math.max(0.001, subject.chinY - subject.headTop);
  const minDrop = head * config.landmarks.minSegmentFracHead;
  const shoulder = subject.shouldersY;
  if (ankle != null && (knee == null || ankle - knee > minDrop)) {
    const extent = measureExtent(subject, "full", config);
    if (extent.rect.h < config.shots.environment.modeSwitchSubjH) return "wide";
    return "full";
  }
  if (knee != null && hip != null && knee - hip > minDrop) return "three-quarter";
  if (hip != null && shoulder != null && hip - shoulder > minDrop) return "medium";
  return "close";
}
