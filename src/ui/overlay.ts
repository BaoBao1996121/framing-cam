import { coverTransform, normRectToScreen } from "../composition/geometry";
import type { FramePlan, GuidanceCode, Subject } from "../composition/types";

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

  drawArrow(context, input.plan.guidance, width, height);
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
