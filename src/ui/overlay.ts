import { coverTransform, normRectToScreen } from "../composition/geometry";
import type { FramePlan, GuidanceCode, Rect, Subject } from "../composition/types";

export function drawOverlay(
  context: CanvasRenderingContext2D,
  input: {
    width: number;
    height: number;
    imageWidth: number;
    imageHeight: number;
    mirror: boolean;
    plan: FramePlan;
    subjects: Subject[];
    roll: number | null;
    guideTarget?: Rect | null;
    guideSubject?: Rect | null;
    guideAligned?: boolean;
    guideHint?: GuidanceCode | "hold";
    guideScore?: number;
  },
): void {
  const { width, height } = input;
  context.clearRect(0, 0, width, height);
  if (input.imageWidth < 2 || input.imageHeight < 2) return;
  const cover = coverTransform(input.imageWidth, input.imageHeight, width, height);
  const box = normRectToScreen(input.plan.showRefinedCrop ? input.plan.crop : input.plan.viewfinder, cover, input.mirror);

  if (input.plan.showRefinedCrop) {
    context.save();
    context.fillStyle = "rgba(12, 10, 8, 0.28)";
    context.beginPath();
    context.rect(0, 0, width, height);
    context.rect(box.x, box.y, box.w, box.h);
    context.fill("evenodd");
    context.restore();
  }

  if (!input.guideTarget) return;
  const score = input.guideScore ?? (input.guideAligned ? 1 : 0.35);
  const tone = input.guideAligned ? "#d7ef6a" : "#f0a35e";
  const ghost = normRectToScreen(input.guideTarget, cover, input.mirror);
  fillBust(context, ghost, tone, input.guideAligned ? 0.78 : 0.22 + Math.max(0, Math.min(1, score)) * 0.38);
  const hint = input.guideHint ?? input.plan.guidance;
  if (!input.guideAligned) drawBigArrow(context, hint, width, height, Math.max(0.2, 1 - score));
}

export function fillBust(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  color: string,
  alpha: number,
): void {
  const cx = rect.x + rect.w / 2;
  const headR = Math.max(14, Math.min(rect.w * 0.22, rect.h * 0.28));
  const headY = rect.y + headR * 1.15;
  const neck = headY + headR * 0.95;
  const shoulderY = Math.min(rect.y + rect.h * 0.72, neck + headR * 0.9);
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;
  context.beginPath();
  context.ellipse(cx, headY, headR * 0.82, headR, 0, 0, Math.PI * 2);
  context.moveTo(cx - headR * 0.45, neck);
  context.quadraticCurveTo(cx - rect.w * 0.48, shoulderY, cx - rect.w * 0.42, rect.y + rect.h);
  context.lineTo(cx + rect.w * 0.42, rect.y + rect.h);
  context.quadraticCurveTo(cx + rect.w * 0.48, shoulderY, cx + headR * 0.45, neck);
  context.closePath();
  context.fill();
  context.restore();
}

export function strokeFigure(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  color: string,
  width: number,
  dash: number[],
): void {
  const cx = rect.x + rect.w / 2;
  const headR = Math.max(8, Math.min(rect.w, rect.h) * 0.18);
  const headY = rect.y + headR * 1.2;
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.shadowColor = "rgba(22, 19, 15, 0.55)";
  context.shadowBlur = 3;
  context.setLineDash(dash);
  context.beginPath();
  context.ellipse(cx, headY, headR * 0.82, headR, 0, 0, Math.PI * 2);
  context.moveTo(cx, headY + headR);
  context.lineTo(cx, rect.y + rect.h * 0.62);
  context.moveTo(cx - rect.w * 0.38, rect.y + rect.h * 0.36);
  context.quadraticCurveTo(cx, rect.y + rect.h * 0.26, cx + rect.w * 0.38, rect.y + rect.h * 0.36);
  context.moveTo(cx - rect.w * 0.28, rect.y + rect.h * 0.42);
  context.lineTo(cx - rect.w * 0.36, rect.y + rect.h * 0.68);
  context.moveTo(cx + rect.w * 0.28, rect.y + rect.h * 0.42);
  context.lineTo(cx + rect.w * 0.36, rect.y + rect.h * 0.68);
  context.moveTo(cx, rect.y + rect.h * 0.62);
  context.lineTo(cx - rect.w * 0.18, rect.y + rect.h);
  context.moveTo(cx, rect.y + rect.h * 0.62);
  context.lineTo(cx + rect.w * 0.18, rect.y + rect.h);
  context.stroke();
  context.restore();
}

function drawBigArrow(
  context: CanvasRenderingContext2D,
  hint: string,
  width: number,
  height: number,
  magnitude: number,
): void {
  const dir = hint === "closer" ? [0, -1] : hint === "back" ? [0, 1] : phoneArrow(hint);
  if (!dir) return;
  const length = Math.round(120 + Math.min(80, magnitude * 100));
  paintArrow(context, width / 2, height * 0.58, dir[0] * length, dir[1] * length, length, hint === "closer" || hint === "back" ? "#ffb089" : "#f0a35e");
}

/** Phone-move direction. `left` means slide the phone left, which carries the person onto the silhouette. */
function phoneArrow(hint: string): [number, number] | null {
  if (hint === "left") return [-1, 0];
  if (hint === "right") return [1, 0];
  if (hint === "up") return [0, -1];
  if (hint === "down") return [0, 1];
  if (hint === "raiseLeft") return [-0.45, -1];
  if (hint === "raiseRight") return [0.45, -1];
  return null;
}

function paintArrow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  length: number,
  color = "#f0a35e",
): void {
  context.save();
  context.translate(x, y);
  context.rotate(Math.atan2(dy, dx));
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = 14;
  context.lineCap = "round";
  context.shadowColor = "rgba(0,0,0,0.35)";
  context.shadowBlur = 10;
  const head = Math.min(36, length * 0.28);
  context.beginPath();
  context.moveTo(-length * 0.42, 0);
  context.lineTo(length * 0.18, 0);
  context.stroke();
  context.beginPath();
  context.moveTo(length * 0.48, 0);
  context.lineTo(length * 0.48 - head, -head * 0.72);
  context.lineTo(length * 0.48 - head * 0.45, 0);
  context.lineTo(length * 0.48 - head, head * 0.72);
  context.closePath();
  context.fill();
  context.restore();
}

