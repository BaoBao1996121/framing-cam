import { FaceLandmarker, FilesetResolver, ImageSegmenter, PoseLandmarker } from "@mediapipe/tasks-vision";
import { headTopFromCategoryMask } from "../composition/head-top";
import type { RawFace, RawPoint, RawPose } from "../composition/subject";
import { eyesClosedFromBlend, type BlendCategory } from "../guidance/eyes";
import { installImportScriptsShim } from "./loader";

export type VisionPaths = {
  wasmPath: string;
  poseModel: string;
  faceModel: string;
  segmentModel?: string;
  cpuOnly?: boolean;
};

export type Detection = {
  faces: RawFace[];
  poses: RawPose[];
  inferenceMs: number;
  delegate: "CPU" | "GPU";
  faceReady: boolean;
  faceError: string;
  frameWidth: number;
  frameHeight: number;
  eyesClosed: boolean;
  maskHeadTop: number | null;
};

const FACE = {
  forehead: 10,
  chin: 152,
  nose: 1,
  leftCheek: 234,
  rightCheek: 454,
  leftEye: [33, 133, 159, 145],
  rightEye: [263, 362, 386, 374],
};

type Scope = typeof globalThis & {
  importScripts?: (url: string) => void;
  ModuleFactory?: (moduleArg?: unknown) => Promise<unknown>;
};

function centroid(landmarks: { x: number; y: number }[], indices: number[]): RawPoint | null {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const index of indices) {
    const point = landmarks[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    x += point.x;
    y += point.y;
    count += 1;
  }
  if (!count) return null;
  return { x: x / count, y: y / count };
}

function pointAt(landmarks: { x: number; y: number }[], index: number): RawPoint | null {
  const point = landmarks[index];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: point.x, y: point.y };
}

export function slimFaces(landmarks: { x: number; y: number }[][]): RawFace[] {
  const faces: RawFace[] = [];
  for (const faceLandmarks of landmarks) {
    if (faceLandmarks.length < 100) continue;
    const forehead = pointAt(faceLandmarks, FACE.forehead);
    const chin = pointAt(faceLandmarks, FACE.chin);
    const nose = pointAt(faceLandmarks, FACE.nose);
    let leftEye = centroid(faceLandmarks, FACE.leftEye);
    let rightEye = centroid(faceLandmarks, FACE.rightEye);
    if (!forehead || !chin) continue;
    const faceH = Math.max(0.04, chin.y - forehead.y);
    if (!leftEye) leftEye = { x: forehead.x - faceH * 0.25, y: forehead.y + faceH * 0.4 };
    if (!rightEye) rightEye = { x: forehead.x + faceH * 0.25, y: forehead.y + faceH * 0.4 };
    const nosePoint = nose ?? { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + chin.y) / 2 };
    const leftCheek = pointAt(faceLandmarks, FACE.leftCheek) ?? {
      x: Math.min(leftEye.x, rightEye.x) - faceH * 0.25,
      y: nosePoint.y,
    };
    const rightCheek = pointAt(faceLandmarks, FACE.rightCheek) ?? {
      x: Math.max(leftEye.x, rightEye.x) + faceH * 0.25,
      y: nosePoint.y,
    };
    faces.push({ forehead, chin, nose: nosePoint, leftEye, rightEye, leftCheek, rightCheek });
  }
  return faces;
}

export function slimPoses(landmarks: { x: number; y: number; visibility?: number }[][]): RawPose[] {
  return landmarks.map((row) => ({
    landmarks: row.map((point) => ({
      x: point.x,
      y: point.y,
      visibility: point.visibility ?? 1,
    })),
  }));
}

function explicitCanvas(): HTMLCanvasElement | undefined {
  const root = globalThis as typeof globalThis & { document?: Document };
  if (!root.document?.createElement) return undefined;
  const canvas = root.document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  return canvas;
}

export class Detectors {
  delegate: "CPU" | "GPU" = "CPU";
  faceReady = false;
  faceError = "";
  private pose: PoseLandmarker | null = null;
  private face: FaceLandmarker | null = null;
  private segmenter: ImageSegmenter | null = null;
  private segmentUrl = "";
  private maskHeadTop: number | null = null;
  private lastSegment = 0;
  private poseTime = 0;
  private faceTime = 0;
  private faceStride = 1;
  private frameCount = 0;
  private lastFaces: RawFace[] = [];
  private lastEyesClosed = false;
  private factory: ((moduleArg?: unknown) => Promise<unknown>) | undefined;
  private wasmBase = "";
  private cpuOnly = false;

  static async create(paths: VisionPaths): Promise<Detectors> {
    const detectors = new Detectors();
    await detectors.start(paths);
    return detectors;
  }

  private async freshVision(): Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> {
    const scope = globalThis as Scope;
    if (!this.factory) throw new Error("ModuleFactory not set");
    scope.ModuleFactory = this.factory;
    return FilesetResolver.forVisionTasks(this.wasmBase, true);
  }

  private async createPose(model: string): Promise<PoseLandmarker> {
    const options = {
      runningMode: "VIDEO" as const,
      numPoses: 2,
      minPoseDetectionConfidence: 0.35,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
      outputSegmentationMasks: false,
    };
    const make = async (useCpu: boolean) => {
      const vision = await this.freshVision();
      const canvas = explicitCanvas();
      return PoseLandmarker.createFromOptions(vision, {
        ...options,
        ...(canvas ? { canvas } : {}),
        baseOptions: { modelAssetPath: model, delegate: useCpu ? "CPU" : "GPU" },
      });
    };
    if (this.cpuOnly) return make(true);
    try {
      return await make(false);
    } catch {
      this.cpuOnly = true;
      this.delegate = "CPU";
      return make(true);
    }
  }

  private async createFace(model: string): Promise<FaceLandmarker> {
    const options = {
      runningMode: "VIDEO" as const,
      numFaces: 2,
      minFaceDetectionConfidence: 0.3,
      minFacePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    };
    const make = async (useCpu: boolean) => {
      const vision = await this.freshVision();
      const canvas = explicitCanvas();
      return FaceLandmarker.createFromOptions(vision, {
        ...options,
        ...(canvas ? { canvas } : {}),
        baseOptions: { modelAssetPath: model, delegate: useCpu ? "CPU" : "GPU" },
      });
    };
    if (this.cpuOnly) return make(true);
    try {
      return await make(false);
    } catch {
      return make(true);
    }
  }

  private async start(paths: VisionPaths): Promise<void> {
    installImportScriptsShim();
    this.wasmBase = paths.wasmPath.replace(/\/$/, "");
    this.cpuOnly = Boolean(paths.cpuOnly);
    this.delegate = this.cpuOnly ? "CPU" : "GPU";
    const scope = globalThis as Scope;
    const imported = (await import(/* @vite-ignore */ `${this.wasmBase}/vision_wasm_module_internal.js`)) as {
      default?: (moduleArg?: unknown) => Promise<unknown>;
    };
    this.factory = imported.default ?? scope.ModuleFactory;
    if (typeof this.factory !== "function") throw new Error("ModuleFactory not set");
    scope.ModuleFactory = this.factory;
    try {
      this.pose = await this.createPose(paths.poseModel);
    } catch (error) {
      throw new Error(`pose ${error instanceof Error ? error.message : String(error)}`);
    }
    if (this.cpuOnly) this.delegate = "CPU";
    try {
      this.face = await this.createFace(paths.faceModel);
      this.faceError = "";
    } catch (error) {
      this.face = null;
      this.faceError = error instanceof Error ? error.message : String(error);
      if (!this.cpuOnly) {
        this.cpuOnly = true;
        this.delegate = "CPU";
        this.face = await this.createFace(paths.faceModel);
        this.faceError = "";
      }
    }
    this.faceReady = this.face != null;
    this.segmentUrl = paths.segmentModel ?? "";
    if (this.segmentUrl) void this.createSegmenter();
  }

  private async createSegmenter(): Promise<void> {
    try {
      const vision = await this.freshVision();
      const canvas = explicitCanvas();
      this.segmenter = await ImageSegmenter.createFromOptions(vision, {
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
        ...(canvas ? { canvas } : {}),
        baseOptions: { modelAssetPath: this.segmentUrl, delegate: "CPU" },
      });
    } catch {
      this.segmenter = null;
    }
  }

  detect(image: ImageData, timestamp: number): Detection {
    if (!this.pose) throw new Error("pose");
    if (image.width < 2 || image.height < 2) throw new Error(`frame ${image.width}x${image.height}`);
    if (timestamp > this.poseTime) this.poseTime = timestamp;
    else this.poseTime += 1;
    const started = performance.now();
    const poseResult = this.pose.detectForVideo(image, this.poseTime);
    this.frameCount += 1;
    const poseCount = poseResult.landmarks.length;
    if (this.face && (poseCount === 0 || this.frameCount % this.faceStride === 0)) {
      if (timestamp > this.faceTime) this.faceTime = timestamp;
      else this.faceTime += 1;
      const faceStarted = performance.now();
      const faceResult = this.face.detectForVideo(image, this.faceTime) as {
        faceLandmarks: { x: number; y: number }[][];
        faceBlendshapes?: { categories?: BlendCategory[] }[];
      };
      this.lastFaces = slimFaces(faceResult.faceLandmarks);
      this.lastEyesClosed = eyesClosedFromBlend(faceResult.faceBlendshapes?.[0]?.categories);
      if (performance.now() - faceStarted > 50) this.faceStride = 2;
      else this.faceStride = 1;
    }
    if (this.segmenter && this.lastFaces[0] && timestamp - this.lastSegment > 700 && performance.now() - started < 45) {
      this.lastSegment = timestamp;
      try {
        const maskResult = this.segmenter.segmentForVideo(image, this.poseTime);
        const mask = maskResult.categoryMask;
        const face = this.lastFaces[0];
        if (mask) {
          const top = headTopFromCategoryMask(
            mask.getAsUint8Array(),
            mask.width,
            mask.height,
            Math.min(face.leftCheek.x, face.leftEye.x),
            Math.max(face.rightCheek.x, face.rightEye.x),
          );
          if (top != null) this.maskHeadTop = top;
          mask.close();
        }
      } catch {
        this.maskHeadTop = null;
      }
    }
    return {
      faces: this.lastFaces,
      poses: slimPoses(poseResult.landmarks),
      inferenceMs: performance.now() - started,
      delegate: this.delegate,
      faceReady: this.face != null,
      faceError: this.faceError,
      frameWidth: image.width,
      frameHeight: image.height,
      eyesClosed: this.lastEyesClosed,
      maskHeadTop: this.maskHeadTop,
    };
  }

  close(): void {
    this.pose?.close();
    this.face?.close();
    this.segmenter?.close();
    this.pose = null;
    this.face = null;
    this.segmenter = null;
  }
}
