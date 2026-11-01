import type { RawFace, RawPose } from "../composition/subject";
import type { Detectors } from "./runtime";

export type Perception = { faces: RawFace[]; poses: RawPose[]; inferenceMs: number; eyesClosed: boolean; maskHeadTop: number | null };
export type VisionPaths = {
  wasmPath: string;
  poseModel: string;
  faceModel: string;
  segmentModel?: string;
  cpuOnly?: boolean;
  mainThread?: boolean;
};

type WorkerData = {
  type: string;
  message?: string;
  faceError?: string;
  faces?: RawFace[];
  poses?: RawPose[];
  inferenceMs?: number;
  pose?: boolean;
  face?: boolean;
  faceReady?: boolean;
  delegate?: string;
  frameWidth?: number;
  frameHeight?: number;
  eyesClosed?: boolean;
  maskHeadTop?: number | null;
};

export class VisionClient {
  private worker: Worker | null = null;
  private main: Detectors | null = null;
  private paths: VisionPaths | null = null;
  private fallbackStarted = false;
  private workerTimer = 0;
  private busy = false;
  private timer = 0;
  ready = false;
  failed = false;
  faceReady = false;
  faceError = "";
  delegate = "";
  /** Where the landmarkers are running after init. */
  place: "" | "worker" | "main" = "";
  /** Why the worker was abandoned, when detection moved to the main thread. */
  note = "";
  frameWidth = 0;
  frameHeight = 0;

  onResult: (perception: Perception) => void = () => {};
  onReady: (info: { pose: boolean; face: boolean }) => void = () => {};
  onError: (message: string) => void = () => {};

  init(paths: VisionPaths): void {
    this.paths = paths;
    if (paths.mainThread) {
      this.fallbackStarted = true;
      void this.startMain("");
      return;
    }
    this.startWorker();
  }

  private startWorker(): void {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker = worker;
    this.workerTimer = window.setTimeout(() => this.fallback("超时"), 25000);
    worker.onmessage = (event: MessageEvent<WorkerData>) => {
      if (this.worker !== worker) return;
      const data = event.data;
      if (data.type === "ready") {
        if (this.place === "main") return;
        this.becomeReady("worker", Boolean(data.face), data.faceError || "", data.delegate || "");
        return;
      }
      if (data.type === "result") {
        this.clearBusy();
        if (data.delegate) this.delegate = `${data.delegate} worker`;
        if (typeof data.faceReady === "boolean") this.faceReady = data.faceReady;
        this.frameWidth = data.frameWidth ?? 0;
        this.frameHeight = data.frameHeight ?? 0;
        this.onResult({
          faces: data.faces ?? [],
          poses: data.poses ?? [],
          inferenceMs: data.inferenceMs ?? 0,
          eyesClosed: Boolean(data.eyesClosed),
          maskHeadTop: data.maskHeadTop ?? null,
        });
        return;
      }
      if (data.type === "error") {
        this.clearBusy();
        if (!this.ready) {
          this.fallback(data.message || "worker");
          return;
        }
        this.onError(data.message || "vision");
      }
    };
    worker.onerror = () => {
      if (this.worker !== worker) return;
      this.clearBusy();
      if (!this.ready) this.fallback("worker");
      else this.onError("worker");
    };
    worker.postMessage({ type: "init", ...this.paths });
  }

  private becomeReady(place: "worker" | "main", face: boolean, faceError: string, delegate: string): void {
    window.clearTimeout(this.workerTimer);
    this.place = place;
    this.ready = true;
    this.failed = false;
    this.faceReady = face;
    this.faceError = faceError;
    this.delegate = delegate ? `${delegate} ${place}` : place;
    this.onReady({ pose: true, face });
  }

  private fallback(reason: string): void {
    if (this.fallbackStarted || this.place === "main") {
      if (!this.ready) this.onError(reason);
      return;
    }
    this.fallbackStarted = true;
    this.note = reason;
    window.clearTimeout(this.workerTimer);
    this.worker?.terminate();
    this.worker = null;
    this.clearBusy();
    void this.startMain(reason);
  }

  private async startMain(workerReason: string): Promise<void> {
    try {
      const runtime = await import("./runtime");
      if (!this.paths) throw new Error("paths");
      this.main = await runtime.Detectors.create(this.paths);
      this.becomeReady("main", this.main.faceReady, this.main.faceError, this.main.delegate);
    } catch (error) {
      const mainReason = error instanceof Error ? error.message : String(error);
      this.failed = true;
      this.onError(`${workerReason}; ${mainReason}`);
    }
  }

  send(frame: { width: number; height: number; data: Uint8ClampedArray }, timestamp: number): void {
    if (this.busy || !this.ready) return;
    if (this.main) {
      this.busy = true;
      try {
        const pixels = new Uint8ClampedArray(frame.data);
        const image = new ImageData(pixels, frame.width, frame.height);
        const found = this.main.detect(image, timestamp);
        this.delegate = `${found.delegate} main`;
        this.faceReady = found.faceReady;
        this.faceError = found.faceError;
        this.frameWidth = found.frameWidth;
        this.frameHeight = found.frameHeight;
        this.onResult({
          faces: found.faces,
          poses: found.poses,
          inferenceMs: found.inferenceMs,
          eyesClosed: found.eyesClosed,
          maskHeadTop: found.maskHeadTop,
        });
      } catch (error) {
        this.onError(error instanceof Error ? error.message : "frame");
      } finally {
        this.busy = false;
      }
      return;
    }
    if (!this.worker) return;
    const buffer = frame.data.buffer.slice(frame.data.byteOffset, frame.data.byteOffset + frame.data.byteLength);
    this.busy = true;
    this.timer = window.setTimeout(() => this.clearBusy(), 1500);
    this.worker.postMessage(
      { type: "frame", width: frame.width, height: frame.height, buffer, timestamp },
      [buffer],
    );
  }

  close(): void {
    window.clearTimeout(this.workerTimer);
    this.clearBusy();
    this.worker?.terminate();
    this.worker = null;
    this.main?.close();
    this.main = null;
    this.ready = false;
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
