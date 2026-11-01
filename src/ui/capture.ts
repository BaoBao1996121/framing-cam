import type { Rect } from "../composition/types";

export function canvasFromVideo(video: HTMLVideoElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function renderCrop(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  crop: Rect,
  mirror: boolean,
): HTMLCanvasElement {
  const sx = clampInt(crop.x * sourceWidth, 0, sourceWidth - 1);
  const sy = clampInt(crop.y * sourceHeight, 0, sourceHeight - 1);
  const sw = clampInt(crop.w * sourceWidth, 1, sourceWidth - sx);
  const sh = clampInt(crop.h * sourceHeight, 1, sourceHeight - sy);
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  if (mirror) {
    context.translate(sw, 0);
    context.scale(-1, 1);
  }
  context.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvas;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function snapshotDataUrl(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): string {
  const scale = Math.min(1, 768 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("jpeg"))), "image/jpeg", quality);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

let audio: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!audio) audio = new Ctx();
    void audio.resume().catch(() => undefined);
  } catch {
    /* A refused audio context must not block the camera. */
  }
}

export function shutterClick(): void {
  if (!audio) return;
  try {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = 1400;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.03, audio.currentTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.07);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.08);
  } catch {
    /* autoplay policies vary */
  }
}

let lastSpokenAt = 0;
let lastSpoken = "";

export function speakPrompt(text: string, locale: string): void {
  if (!("speechSynthesis" in window) || !text) return;
  const now = performance.now();
  const urgent = /^\d$/.test(text);
  if (!urgent && text === lastSpoken && now - lastSpokenAt < 4000) return;
  if (!urgent && now - lastSpokenAt < 1800) return;
  lastSpoken = text;
  lastSpokenAt = now;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = locale === "en" ? "en-US" : "zh-CN";
  utterance.rate = 1.04;
  window.speechSynthesis.speak(utterance);
}

export function pulse(duration = 28): void {
  try {
    navigator.vibrate?.(duration);
  } catch {
    /* iOS Safari has no vibration API. */
  }
}
