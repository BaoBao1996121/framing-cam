import type { RawFace, RawPose } from "../composition/subject";

export type Perception = { faces: RawFace[]; poses: RawPose[]; inferenceMs: number };

export class VisionClient {
  private worker: Worker;
  private busy = false;
  private timer = 0;
  ready = false;
  failed = false;
  faceReady = false;
  faceError = "";

  onResult: (perception: Perception) => void = () => {};
  onReady: (info: { pose: boolean; face: boolean }) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; message?: string; faceError?: string; faces?: RawFace[]; poses?: RawPose[]; inferenceMs?: number; pose?: boolean; face?: boolean; faceReady?: boolean; delegate?: string; frameWidth?: number; frameHeight?: number };
      if (data.type === "ready") {
        this.ready = true;
        this.faceReady = Boolean(data.face);
        this.faceError = data.faceError || "";
        if (data.delegate) this.delegate = data.delegate;
        this.onReady({ pose: Boolean(data.pose), face: this.faceReady });
        return;
      }
      if (data.type === "result") {
        this.clearBusy();
        if (data.delegate) this.delegate = data.delegate;
        if (typeof data.faceReady === "boolean") this.faceReady = data.faceReady;
        this.frameWidth = data.frameWidth ?? 0;
        this.frameHeight = data.frameHeight ?? 0;
        this.onResult({
          faces: data.faces ?? [],
          poses: data.poses ?? [],
          inferenceMs: data.inferenceMs ?? 0,
        });
        return;
      }
      if (data.type === "error") {
        this.clearBusy();
        this.failed = !this.ready;
        this.onError(data.message || "vision");
      }
    };
    this.worker.onerror = () => {
      this.clearBusy();
      this.failed = !this.ready;
      this.onError("worker");
    };
  }

  delegate = "";
  frameWidth = 0;
  frameHeight = 0;

  init(paths: { wasmPath: string; poseModel: string; faceModel: string; cpuOnly?: boolean }): void {
    this.worker.postMessage({ type: "init", ...paths });
  }

  send(frame: { width: number; height: number; data: Uint8ClampedArray }, timestamp: number): void {
    if (this.busy || !this.ready) return;
    const buffer = frame.data.buffer.slice(frame.data.byteOffset, frame.data.byteOffset + frame.data.byteLength);
    this.busy = true;
    this.timer = window.setTimeout(() => this.clearBusy(), 1500);
    this.worker.postMessage(
      { type: "frame", width: frame.width, height: frame.height, buffer, timestamp },
      [buffer],
    );
  }

  close(): void {
    this.clearBusy();
    this.worker.terminate();
  }

  private clearBusy(): void {
    this.busy = false;
    window.clearTimeout(this.timer);
  }
}

/** Join a public asset onto Vite's base, whether that base is `/framing-cam/` or a full URL. */
export function publicUrl(baseUrl: string, pageHref: string, assetPath: string): string {
  const base = new URL(baseUrl, pageHref);
  const relative = assetPath.replace(/^\//, "");
  return new URL(relative, base).href;
}

export function vendorUrl(path: string): string {
  return publicUrl(import.meta.env.BASE_URL, window.location.href, path);
}
