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
      const data = event.data as { type: string; message?: string; faceError?: string; faces?: RawFace[]; poses?: RawPose[]; inferenceMs?: number; pose?: boolean; face?: boolean };
      if (data.type === "ready") {
        this.ready = true;
        this.faceReady = Boolean(data.face);
        this.faceError = data.faceError || "";
        this.onReady({ pose: Boolean(data.pose), face: this.faceReady });
        return;
      }
      if (data.type === "result") {
        this.clearBusy();
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

  init(paths: { wasmPath: string; poseModel: string; faceModel: string }): void {
    this.worker.postMessage({ type: "init", ...paths });
  }

  send(bitmap: ImageBitmap, timestamp: number): void {
    if (this.busy || !this.ready) {
      bitmap.close();
      return;
    }
    this.busy = true;
    this.timer = window.setTimeout(() => this.clearBusy(), 1500);
    this.worker.postMessage({ type: "frame", bitmap, timestamp }, [bitmap]);
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
