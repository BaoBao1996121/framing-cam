import { EYE_LINE, IDEAL_HEADROOM, MAX_DIGITAL_ZOOM, idealHeadFraction } from "./constants";
import {
  clamp,
  containsPoint,
  digitalZoom,
  largestAspectRect,
  pixelAspect,
  rectFromAnchor,
  snapToAspect,
  toNorm,
  toPx,
  type PxRect,
} from "./geometry";
import { headHeight } from "./subject";
import { ASPECTS, type AspectId, type FramingKind, type Rect, type Subject } from "./types";

export type CropEvaluation = {
  score: number;
  zoom: number;
  joint: number;
  hardFail: "bounds" | "aspect" | "head" | "zoom" | null;
};

export function placementForYaw(yaw: number): number {
  if (yaw > 0.18) return 0.37;
  if (yaw < -0.18) return 0.63;
  return 0.5;
}

export function jointEdgePenalty(crop: Rect, joint: { x: number; y: number }, band: number): number {
  const left = crop.x;
  const right = crop.x + crop.w;
  const top = crop.y;
  const bottom = crop.y + crop.h;
  const dx = joint.x < left ? left - joint.x : joint.x > right ? joint.x - right : 0;
  const dy = joint.y < top ? top - joint.y : joint.y > bottom ? joint.y - bottom : 0;
  const distance = dx === 0 && dy === 0
    ? Math.min(joint.x - left, right - joint.x, joint.y - top, bottom - joint.y)
    : Math.hypot(dx, dy);
  if (distance >= band) return 0;
  return 1 - distance / band;
}

/** 1 when the bottom edge slices the neck between chin and shoulders. */
export function neckCut(cropBottom: number, chinY: number, shouldersY: number | null): number {
  if (shouldersY == null) return 0;
  const span = shouldersY - chinY;
  if (span <= 0.012) return 0;
  const start = chinY + span * 0.25;
  const end = chinY + span * 0.8;
  return cropBottom > start && cropBottom < end ? 1 : 0;
}

export function jointBand(subject: Subject): number {
  return Math.max(0.018, headHeight(subject) * 0.2);
}

export function totalJointPenalty(crop: Rect, subject: Subject): number {
  const band = jointBand(subject);
  let sum = neckCut(crop.y + crop.h, subject.chinY, subject.shouldersY) * 1.25;
  for (const joint of subject.joints) sum += jointEdgePenalty(crop, joint, band);
  return sum;
}

export function headContained(crop: Rect, subject: Subject): boolean {
  const top = clamp(subject.headTop, 0, 1);
  const bottom = clamp(subject.chinY, 0, 1);
  const left = clamp(subject.headLeft, 0, 1);
  const right = clamp(subject.headRight, 0, 1);
  const eye = { x: clamp(subject.eye.x, 0, 1), y: clamp(subject.eye.y, 0, 1) };
  const midX = (left + right) / 2;
  const midY = (top + bottom) / 2;
  return [eye, { x: midX, y: top }, { x: midX, y: bottom }, { x: left, y: midY }, { x: right, y: midY }].every(
    (point) => containsPoint(crop, point, 0.01),
  );
}

export function evaluateCrop(
  crop: Rect,
  subject: Subject,
  imageWidth: number,
  imageHeight: number,
  aspect: AspectId,
  viewfinder: Rect,
  maxZoom = MAX_DIGITAL_ZOOM,
): CropEvaluation {
  const empty = { score: -1e9, zoom: Number.POSITIVE_INFINITY, joint: 0, hardFail: "bounds" as const };
  if (!(crop.w > 0) || !(crop.h > 0)) return empty;
  if (crop.x < -0.004 || crop.y < -0.004 || crop.x + crop.w > 1.004 || crop.y + crop.h > 1.004) return empty;
  const aspectError = Math.abs(pixelAspect(crop, imageWidth, imageHeight) / ASPECTS[aspect] - 1);
  if (aspectError > 0.02) {
    return { score: -1e9, zoom: digitalZoom(crop, viewfinder), joint: 0, hardFail: "aspect" };
  }
  if (!headContained(crop, subject)) {
    return { score: -1e9, zoom: digitalZoom(crop, viewfinder), joint: 0, hardFail: "head" };
  }

  const zoom = digitalZoom(crop, viewfinder);
  const eyeRelY = (subject.eye.y - crop.y) / crop.h;
  const eyeScore = 1 - clamp(Math.abs(eyeRelY - EYE_LINE) / 0.18, 0, 1);
  const headroom = (Math.max(subject.headTop, 0) - crop.y) / crop.h;
  const headroomScore = headroom < -0.01 ? 0 : 1 - clamp(Math.abs(headroom - IDEAL_HEADROOM) / 0.16, 0, 1);
  const eyeRelX = (subject.eye.x - crop.x) / crop.w;
  const xScore = 1 - clamp(Math.abs(eyeRelX - placementForYaw(subject.yaw)) / 0.26, 0, 1);
  const fraction = headHeight(subject) / crop.h;
  const scaleScore = 1 - clamp(Math.abs(Math.log(fraction / idealHeadFraction(aspect))) / Math.log(1.85), 0, 1);
  const joint = totalJointPenalty(crop, subject);
  const jointScore = 1 - clamp(joint / 1.5, 0, 1);
  let shoulderScore = 1;
  if (subject.shouldersY != null && crop.y + crop.h > subject.shouldersY - 0.005 && subject.shoulders.length) {
    const inside = subject.shoulders.filter((point) => point.x >= crop.x - 0.01 && point.x <= crop.x + crop.w + 0.01).length;
    shoulderScore = inside / subject.shoulders.length;
  }
  const zoomScore = 1 - clamp((zoom - 1) / Math.max(0.25, maxZoom - 1), 0, 1);
  const score =
    3.1 * eyeScore +
    2.2 * headroomScore +
    1.8 * xScore +
    1.7 * scaleScore +
    3.6 * jointScore +
    1.1 * shoulderScore +
    0.55 * zoomScore;
  return {
    score,
    zoom,
    joint,
    hardFail: zoom > maxZoom + 0.03 ? "zoom" : null,
  };
}

function averageY(subject: Subject, name: Subject["joints"][number]["name"]): number | null {
  const rows = subject.joints.filter((joint) => joint.name === name);
  if (!rows.length) return null;
  return rows.reduce((sum, joint) => sum + joint.y, 0) / rows.length;
}

function dedupe(rects: PxRect[]): PxRect[] {
  const seen = new Set<string>();
  const unique: PxRect[] = [];
  for (const rect of rects) {
    const key = [rect.x, rect.y, rect.w, rect.h].map((value) => Math.round(value)).join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(rect);
  }
  return unique;
}

export function buildCandidateRects(subject: Subject, imageWidth: number, imageHeight: number, aspect: AspectId): PxRect[] {
  const aspectValue = ASPECTS[aspect];
  const height = headHeight(subject);
  const anchorX = subject.eye.x * imageWidth;
  const headTop = subject.headTop * imageHeight;
  const bottoms: number[] = [subject.chinY + height * 0.5];
  if (subject.shouldersY != null) {
    bottoms.push(subject.shouldersY + height * 0.55, subject.shouldersY + height * 1.05);
  } else {
    bottoms.push(subject.chinY + height * 1.35);
  }
  const hip = averageY(subject, "hip");
  const knee = averageY(subject, "knee");
  const ankle = averageY(subject, "ankle");
  if (subject.shouldersY != null && hip != null) {
    bottoms.push(subject.shouldersY + (hip - subject.shouldersY) * 0.62, hip + height * 0.3);
  }
  if (hip != null && knee != null) bottoms.push(hip + (knee - hip) * 0.52);
  if (ankle != null) bottoms.push(ankle + height * 0.38);

  const places = placementForYaw(subject.yaw) === 0.5 ? [0.5, 0.42, 0.58] : [placementForYaw(subject.yaw), 0.5];
  const rects: PxRect[] = [];
  for (const headroom of [0.1, 0.24, 0.4]) {
    const top = headTop - headroom * height * imageHeight;
    for (const bottom of bottoms) {
      for (const place of places) {
        const rect = rectFromAnchor(top, bottom * imageHeight, anchorX, place, aspectValue, imageWidth, imageHeight);
        if (rect) rects.push(rect);
      }
    }
  }

  const idealH = (height / idealHeadFraction(aspect)) * imageHeight;
  for (const place of places) {
    const rect = snapToAspect(
      {
        x: anchorX - place * idealH * aspectValue,
        y: subject.eye.y * imageHeight - EYE_LINE * idealH,
        w: idealH * aspectValue,
        h: idealH,
      },
      aspectValue,
      imageWidth,
      imageHeight,
    );
    if (rect) rects.push(rect);
  }
  rects.push(largestAspectRect(imageWidth, imageHeight, aspectValue));
  return dedupe(rects);
}

export function framingOf(crop: Rect, subject: Subject): FramingKind {
  const bottom = crop.y + crop.h;
  const height = headHeight(subject);
  const hip = averageY(subject, "hip");
  const knee = averageY(subject, "knee");
  if (subject.shouldersY != null && bottom < subject.shouldersY + height * 0.28) return "head";
  if (hip != null && bottom < hip + height * 0.12) return "chest";
  if (hip != null && knee != null && bottom < hip + (knee - hip) * 0.35) return "waist";
  if (knee != null && bottom < knee + height * 0.35) return "thigh";
  if (knee != null || averageY(subject, "ankle") != null) return "full";
  if (subject.shouldersY != null && bottom < subject.shouldersY + height * 1.4) return "chest";
  return "viewfinder";
}

export type RankedCrop = { rect: Rect; score: number; zoom: number; joint: number; framing: FramingKind };

export function rankPortraitCrops(
  subject: Subject,
  imageWidth: number,
  imageHeight: number,
  aspect: AspectId,
  maxZoom = MAX_DIGITAL_ZOOM,
): RankedCrop {
  const viewfinder = toNorm(largestAspectRect(imageWidth, imageHeight, ASPECTS[aspect]), imageWidth, imageHeight);
  const evaluated = buildCandidateRects(subject, imageWidth, imageHeight, aspect).map((px) => {
    const rect = toNorm(px, imageWidth, imageHeight);
    const evaluation = evaluateCrop(rect, subject, imageWidth, imageHeight, aspect, viewfinder, maxZoom);
    return { rect, ...evaluation, framing: framingOf(rect, subject) };
  });
  const legal = evaluated.filter((crop) => crop.hardFail == null);
  const pool = legal.length ? legal : evaluated.filter((crop) => crop.hardFail == null || crop.hardFail === "zoom");
  pool.sort((a, b) => {
    if (!legal.length && a.zoom !== b.zoom) return a.zoom - b.zoom;
    return b.score - a.score;
  });
  const winner = pool[0];
  if (!winner) {
    return { rect: viewfinder, score: 0, zoom: 1, joint: 0, framing: "viewfinder" };
  }
  return { rect: winner.rect, score: winner.score, zoom: winner.zoom, joint: winner.joint, framing: winner.framing };
}

export function prepareLlmCrop(
  box: Rect,
  subject: Subject,
  imageWidth: number,
  imageHeight: number,
  aspect: AspectId,
  maxZoom = MAX_DIGITAL_ZOOM,
): Rect | null {
  const snapped = snapToAspect(toPx(box, imageWidth, imageHeight), ASPECTS[aspect], imageWidth, imageHeight);
  if (!snapped) return null;
  const rect = toNorm(snapped, imageWidth, imageHeight);
  const viewfinder = toNorm(largestAspectRect(imageWidth, imageHeight, ASPECTS[aspect]), imageWidth, imageHeight);
  const evaluation = evaluateCrop(rect, subject, imageWidth, imageHeight, aspect, viewfinder, maxZoom);
  if (evaluation.hardFail && evaluation.hardFail !== "zoom") return null;
  if (evaluation.zoom > maxZoom + 0.05) return null;
  if (evaluation.joint > 1.15) return null;
  return rect;
}
