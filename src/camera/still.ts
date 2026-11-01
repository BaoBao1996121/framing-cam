import type { Rect } from "../composition/types";
import { laplacianVariance, pickSharpest } from "../guidance/sharpness";
import { canvasFromVideo } from "../ui/capture";

/** Analysis preview. Guidance stays smooth; the still is a separate, larger grab. */
export const PREVIEW_WIDTH = 960;
export const PREVIEW_HEIGHT = 540;
export const BURST = 4;
export const PHOTO_BURST = 3;

const LEVEL_MIN_DEG = 0.6;
const LEVEL_MAX_DEG = 6;

export function previewConstraints(facing: "user" | "environment") {
  return {
    audio: false as const,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: PREVIEW_WIDTH },
      height: { ideal: PREVIEW_HEIGHT },
      frameRate: { ideal: 30, max: 30 },
    },
  };
}

type SizeCaps = { width?: { max?: number }; height?: { max?: number } };

export function maxPhotoSize(track: { getCapabilities?: () => SizeCaps } | null): { width: number; height: number } | null {
  const caps = track?.getCapabilities?.();
  const width = caps?.width?.max;
  const height = caps?.height?.max;
  if (!width || !height || width < 2 || height < 2) return null;
  return { width: Math.round(width), height: Math.round(height) };
}

/** Only a small, trustworthy tilt. A large roll is left to the holder. */
export function shouldLevel(rollDeg: number | null): boolean {
  if (rollDeg == null || !Number.isFinite(rollDeg)) return false;
  const abs = Math.abs(rollDeg);
  return abs >= LEVEL_MIN_DEG && abs <= LEVEL_MAX_DEG;
}

/** Fraction of the crop to pull in so a small rotation does not show empty corners. */
export function rollInset(rollDeg: number | null): number {
  if (!shouldLevel(rollDeg) || rollDeg == null) return 0;
  const rad = (Math.abs(rollDeg) * Math.PI) / 180;
  return Math.min(0.03, Math.sin(rad) * 0.35);
}

export function insetCrop(crop: Rect, rollDeg: number | null): Rect {
  const margin = rollInset(rollDeg);
  if (margin <= 0) return crop;
  const next = {
    x: crop.x + crop.w * margin,
    y: crop.y + crop.h * margin,
    w: crop.w * (1 - 2 * margin),
    h: crop.h * (1 - 2 * margin),
  };
  if (next.w < 0.05 || next.h < 0.05) return crop;
  return next;
}

export function applyLevel(source: CanvasImageSource, width: number, height: number, rollDeg: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const turn = (-rollDeg * Math.PI) / 180;
  context.translate(width / 2, height / 2);
  context.rotate(turn);
  context.drawImage(source, -width / 2, -height / 2);
  return canvas;
}

export function scoreCanvas(canvas: HTMLCanvasElement): number {
  const probeW = 160;
  const probeH = Math.max(3, Math.round((canvas.height * probeW) / Math.max(1, canvas.width)));
  const probe = document.createElement("canvas");
  probe.width = probeW;
  probe.height = probeH;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return 0;
  context.drawImage(canvas, 0, 0, probeW, probeH);
  const pixels = context.getImageData(0, 0, probeW, probeH);
  return laplacianVariance(pixels.data, probeW, probeH);
}

function nextVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    if (video.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(() => resolve());
      return;
    }
    setTimeout(resolve, 50);
  });
}

async function canvasFromBlob(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return canvas;
}

type PhotoCapture = { takePhoto: () => Promise<Blob> };

function photoCapture(track: MediaStreamTrack): PhotoCapture | null {
  const Ctor = (globalThis as { ImageCapture?: new (track: MediaStreamTrack) => PhotoCapture }).ImageCapture;
  if (!Ctor) return null;
  try {
    return new Ctor(track);
  } catch {
    return null;
  }
}

async function burstPhotos(capture: PhotoCapture, count: number): Promise<HTMLCanvasElement | null> {
  const frames: { canvas: HTMLCanvasElement; score: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    try {
      const canvas = await canvasFromBlob(await capture.takePhoto());
      frames.push({ canvas, score: scoreCanvas(canvas) });
    } catch {
      break;
    }
  }
  return pickSharpest(frames)?.canvas ?? null;
}

async function burstVideo(video: HTMLVideoElement, count: number): Promise<HTMLCanvasElement> {
  const frames: { canvas: HTMLCanvasElement; score: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index > 0) await nextVideoFrame(video);
    if (video.videoWidth < 2) break;
    const canvas = canvasFromVideo(video);
    frames.push({ canvas, score: scoreCanvas(canvas) });
  }
  const best = pickSharpest(frames);
  if (!best) throw new Error("frame");
  return best.canvas;
}

/**
 * A full still. `takePhoto` when the browser has it, otherwise the largest
 * video size the track will allow, then the sharpest of a short burst.
 * The preview constraints are restored afterward.
 */
export async function stillFromVideo(video: HTMLVideoElement, track: MediaStreamTrack | null): Promise<HTMLCanvasElement> {
  if (track) {
    const photos = photoCapture(track);
    if (photos) {
      const still = await burstPhotos(photos, PHOTO_BURST);
      if (still && still.width >= 2) return still;
    }
  }
  const max = maxPhotoSize(track);
  let raised = false;
  if (
    track &&
    max &&
    video.videoWidth >= 2 &&
    (max.width > video.videoWidth * 1.2 || max.height > video.videoHeight * 1.2)
  ) {
    try {
      await track.applyConstraints({ width: { ideal: max.width }, height: { ideal: max.height } });
      await nextVideoFrame(video);
      raised = video.videoWidth > 2;
    } catch {
      raised = false;
    }
  }
  try {
    return await burstVideo(video, BURST);
  } finally {
    if (raised && track) {
      try {
        await track.applyConstraints({
          width: { ideal: PREVIEW_WIDTH },
          height: { ideal: PREVIEW_HEIGHT },
          frameRate: { ideal: 30, max: 30 },
        });
      } catch {
        /* The preview stays at the still size until the camera is opened again. */
      }
    }
  }
}
