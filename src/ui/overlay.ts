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
  },
): void {
  const { width, height } = input;
  context.clearRect(0, 0, width, height);
  if (input.imageWidth < 2 || input.imageHeight < 2) return;
  const cover = coverTransform(input.imageWidth, input.imageHeight, width, height);
  const box = normRectToScreen(input.plan.showRefinedCrop ? input.plan.crop : input.plan.viewfinder, cover, input.mirror);
  const ready = input.plan.guidance === "ready";
  const color = ready ? "#d7ef6a" : "#f6f1e7";

  if (input.plan.showRefinedCrop) {
    context.save();
    context.fillStyle = "rgba(12, 10, 8, 0.28)";
    context.beginPath();
    context.rect(0, 0, width, height);
    context.rect(box.x, box.y, box.w, box.h);
    context.fill("evenodd");
    context.restore();
  }

  if (input.guideTarget) {
    const tone = input.guideAligned ? "#d7ef6a" : "#f0a35e";
    const ghost = normRectToScreen(input.guideTarget, cover, input.mirror);
    strokeFigure(context, ghost, tone, 2.5, [7, 6]);
    if (input.guideSubject) {
      const live = normRectToScreen(input.guideSubject, cover, input.mirror);
      strokeFigure(context, live, input.guideAligned ? "#d7ef6a" : "#f6f1e7", 2.5, []);
      drawMatchArrow(context, live, ghost, input.guideHint ?? input.plan.guidance, Boolean(input.guideAligned));
    }
  } else {
  context.strokeStyle = color;
  context.lineWidth = 2;
  strokeBrackets(context, box.x, box.y, box.w, box.h);

  if (!ready && input.plan.guidance !== "searching") {
    const head = input.plan.headTarget;
    const center = normRectToScreen(
      { x: head.cx, y: head.cy, w: 0, h: 0 },
      cover,
      input.mirror,
    );
    const cap = Math.min(width, height) * 0.16;
    const radiusX = Math.min(Math.max(18, head.rx * cover.drawW), cap);
    const radiusY = Math.min(Math.max(24, head.ry * cover.drawH), cap * 1.2);
    context.save();
    context.setLineDash([5, 7]);
    context.strokeStyle = "rgba(246, 241, 231, 0.8)";
    context.beginPath();
    context.ellipse(center.x, center.y, Math.max(12, radiusX), Math.max(16, radiusY), 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  for (const subject of input.subjects) {
    const eye = normRectToScreen({ x: subject.eye.x, y: subject.eye.y, w: 0, h: 0 }, cover, input.mirror);
    context.beginPath();
    context.strokeStyle = "rgba(246, 241, 231, 0.7)";
    context.lineWidth = 1.5;
    context.arc(eye.x, eye.y, 10, 0, Math.PI * 2);
    context.stroke();
  }

  if (input.roll != null && Math.abs(input.roll) < 70) {
    context.save();
    context.translate(width / 2, 86);
    context.rotate((input.roll * Math.PI) / 180);
    context.strokeStyle = Math.abs(input.roll) < 3 ? "rgba(215, 239, 106, 0.9)" : "rgba(255, 122, 89, 0.95)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-width * 0.22, 0);
    context.lineTo(width * 0.22, 0);
    context.stroke();
    context.restore();
  }

  if (!input.guideTarget) drawArrow(context, input.plan.guidance, width, height);
  }
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

function drawMatchArrow(
  context: CanvasRenderingContext2D,
  live: { x: number; y: number; w: number; h: number },
  ghost: { x: number; y: number; w: number; h: number },
  hint: string,
  aligned: boolean,
): void {
  if (aligned) return;
  const liveC = { x: live.x + live.w / 2, y: live.y + live.h / 2 };
  const ghostC = { x: ghost.x + ghost.w / 2, y: ghost.y + ghost.h / 2 };
  const gap = Math.hypot(ghostC.x - liveC.x, ghostC.y - liveC.y);
  if (hint === "closer" || hint === "back") {
    const reach = Math.max(22, Math.min(64, Math.abs(ghost.h - live.h) * 0.4 + 18));
    cornerArrows(context, live, hint === "back" ? -reach * 0.55 : reach);
    return;
  }
  const dir = phoneArrow(hint);
  if (!dir) return;
  const length = Math.max(40, Math.min(128, gap + 24));
  const ox = liveC.x + dir[0] * Math.min(28, live.w * 0.2);
  const oy = liveC.y + dir[1] * Math.min(28, live.h * 0.15);
  paintArrow(context, ox, oy, dir[0] * length, dir[1] * length, length);
}

/** Phone-move direction. `left` means slide the phone left, which carries the live outline onto the target. */
function phoneArrow(hint: string): [number, number] | null {
  if (hint === "left") return [-1, 0];
  if (hint === "right") return [1, 0];
  if (hint === "up") return [0, -1];
  if (hint === "down") return [0, 1];
  if (hint === "raiseLeft") return [-0.45, -1];
  if (hint === "raiseRight") return [0.45, -1];
  return null;
}

function paintArrow(context: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, length: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(Math.atan2(dy, dx));
  context.fillStyle = "rgba(240, 163, 94, 0.95)";
  context.shadowColor = "rgba(0,0,0,0.35)";
  context.shadowBlur = 10;
  context.beginPath();
  context.moveTo(length, 0);
  context.lineTo(length - 22, -14);
  context.lineTo(length - 14, 0);
  context.lineTo(length - 22, 14);
  context.closePath();
  context.fill();
  context.restore();
}

function cornerArrows(context: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, reach: number): void {
  const spots = [
    [rect.x, rect.y, -1, -1],
    [rect.x + rect.w, rect.y, 1, -1],
    [rect.x, rect.y + rect.h, -1, 1],
    [rect.x + rect.w, rect.y + rect.h, 1, 1],
  ];
  for (const [x, y, sx, sy] of spots) paintArrow(context, x, y, sx * reach, sy * reach, Math.abs(reach));
}

function strokeBrackets(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const len = Math.max(18, Math.min(w, h) * 0.08);
  context.beginPath();
  context.moveTo(x, y + len);
  context.lineTo(x, y);
  context.lineTo(x + len, y);
  context.moveTo(x + w - len, y);
  context.lineTo(x + w, y);
  context.lineTo(x + w, y + len);
  context.moveTo(x + w, y + h - len);
  context.lineTo(x + w, y + h);
  context.lineTo(x + w - len, y + h);
  context.moveTo(x + len, y + h);
  context.lineTo(x, y + h);
  context.lineTo(x, y + h - len);
  context.stroke();
}

function drawArrow(context: CanvasRenderingContext2D, guidance: GuidanceCode, width: number, height: number): void {
  const map: Partial<Record<GuidanceCode, { x: number; y: number; angle: number }>> = {
    left: { x: 46, y: height * 0.42, angle: Math.PI },
    right: { x: width - 46, y: height * 0.42, angle: 0 },
    up: { x: width / 2, y: 108, angle: -Math.PI / 2 },
    down: { x: width / 2, y: height - 196, angle: Math.PI / 2 },
  };
  const arrow = map[guidance];
  if (!arrow) return;
  context.save();
  context.translate(arrow.x, arrow.y);
  context.rotate(arrow.angle);
  context.fillStyle = "rgba(240, 163, 94, 0.95)";
  context.shadowColor = "rgba(0,0,0,0.35)";
  context.shadowBlur = 12;
  context.beginPath();
  context.moveTo(22, 0);
  context.lineTo(-14, -16);
  context.lineTo(-6, 0);
  context.lineTo(-14, 16);
  context.closePath();
  context.fill();
  context.restore();
}
