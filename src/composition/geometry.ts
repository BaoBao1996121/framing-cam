import type { Rect } from "./types";

export type PxRect = { x: number; y: number; w: number; h: number };

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function toPx(rect: Rect, iw: number, ih: number): PxRect {
  return { x: rect.x * iw, y: rect.y * ih, w: rect.w * iw, h: rect.h * ih };
}

export function toNorm(rect: PxRect, iw: number, ih: number): Rect {
  return { x: rect.x / iw, y: rect.y / ih, w: rect.w / iw, h: rect.h / ih };
}

export function pixelAspect(rect: Rect, iw: number, ih: number): number {
  return (rect.w * iw) / Math.max(1e-6, rect.h * ih);
}

/** Largest rectangle of the requested pixel aspect that fits inside the image. */
export function largestAspectRect(iw: number, ih: number, aspect: number): PxRect {
  if (iw <= 0 || ih <= 0 || aspect <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  if (iw / ih > aspect) {
    const h = ih;
    const w = h * aspect;
    return { x: (iw - w) / 2, y: 0, w, h };
  }
  const w = iw;
  const h = w / aspect;
  return { x: 0, y: (ih - h) / 2, w, h };
}

export function snapToAspect(rect: PxRect, aspect: number, iw: number, ih: number): PxRect | null {
  if (!(rect.w > 2) || !(rect.h > 2) || !(aspect > 0)) return null;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let h = rect.h;
  let w = h * aspect;
  if (w > iw) {
    w = iw;
    h = w / aspect;
  }
  if (h > ih) {
    h = ih;
    w = h * aspect;
  }
  if (w > iw + 0.5 || h > ih + 0.5) return null;
  const x = clamp(cx - w / 2, 0, Math.max(0, iw - w));
  const y = clamp(cy - h / 2, 0, Math.max(0, ih - h));
  return { x, y, w, h };
}

/**
 * Build a pixel rect from a vertical span. `anchorX` is placed at `anchorFrac`
 * across the width (0.5 centers the eyes; 0.37 leaves room on the right).
 */
export function rectFromAnchor(
  top: number,
  bottom: number,
  anchorX: number,
  anchorFrac: number,
  aspect: number,
  iw: number,
  ih: number,
): PxRect | null {
  let h = bottom - top;
  if (!(h > 8)) return null;
  let w = h * aspect;
  let x = anchorX - anchorFrac * w;
  let y = top;
  if (w > iw || h > ih) {
    const scale = Math.min(iw / w, ih / h);
    w *= scale;
    h *= scale;
    x = anchorX - anchorFrac * w;
    y = top + (bottom - top - h) * 0.15;
  }
  return snapToAspect({ x, y, w, h }, aspect, iw, ih);
}

export type Cover = { offsetX: number; offsetY: number; drawW: number; drawH: number };

export function coverTransform(srcW: number, srcH: number, dstW: number, dstH: number): Cover {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { offsetX: 0, offsetY: 0, drawW: dstW, drawH: dstH };
  }
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  return { drawW, drawH, offsetX: (dstW - drawW) / 2, offsetY: (dstH - drawH) / 2 };
}

export function imageToScreen(nx: number, ny: number, cover: Cover, mirror: boolean): { x: number; y: number } {
  const x = mirror ? 1 - nx : nx;
  return { x: cover.offsetX + x * cover.drawW, y: cover.offsetY + ny * cover.drawH };
}

export function screenToImage(sx: number, sy: number, cover: Cover, mirror: boolean): { x: number; y: number } {
  let nx = (sx - cover.offsetX) / cover.drawW;
  const ny = (sy - cover.offsetY) / cover.drawH;
  if (mirror) nx = 1 - nx;
  return { x: nx, y: ny };
}

export function normRectToScreen(rect: Rect, cover: Cover, mirror: boolean): PxRect {
  const a = imageToScreen(rect.x, rect.y, cover, mirror);
  const b = imageToScreen(rect.x + rect.w, rect.y + rect.h, cover, mirror);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** 1 means the crop is the full aspect frame. 2 means the crop keeps half that height. */
export function digitalZoom(crop: Rect, viewfinder: Rect): number {
  if (crop.h <= 1e-6 || viewfinder.h <= 1e-6) return Number.POSITIVE_INFINITY;
  return viewfinder.h / crop.h;
}

/** A crop of the requested aspect that wraps the plan's target box. */
export function frameAroundTarget(target: Rect, aspect: number, imageWidth: number, imageHeight: number): Rect {
  const box = toPx(target, imageWidth, imageHeight);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let height = Math.max(box.h * 1.45, (box.w * 1.2) / aspect);
  let width = height * aspect;
  if (width < box.w * 1.2) {
    width = box.w * 1.2;
    height = width / aspect;
  }
  const snapped = snapToAspect({ x: cx - width / 2, y: cy - height / 2, w: width, h: height }, aspect, imageWidth, imageHeight);
  return toNorm(snapped ?? largestAspectRect(imageWidth, imageHeight, aspect), imageWidth, imageHeight);
}

export function containsPoint(rect: Rect, point: { x: number; y: number }, margin = 0): boolean {
  return (
    point.x >= rect.x - margin &&
    point.x <= rect.x + rect.w + margin &&
    point.y >= rect.y - margin &&
    point.y <= rect.y + rect.h + margin
  );
}
