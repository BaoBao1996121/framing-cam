import { FaceLandmarker, FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { RawFace, RawPoint, RawPose } from "../composition/subject";

type InitMessage = { type: "init"; wasmPath: string; poseModel: string; faceModel: string; cpuOnly?: boolean };
type FrameMessage = { type: "frame"; width: number; height: number; buffer: ArrayBuffer; timestamp: number };

const FACE = {
  forehead: 10,
  chin: 152,
  nose: 1,
  leftCheek: 234,
  rightCheek: 454,
  leftEye: [33, 133, 159, 145],
  rightEye: [263, 362, 386, 374],
};

let pose: PoseLandmarker | null = null;
let face: FaceLandmarker | null = null;
let poseTime = 0;
let faceTime = 0;
let faceStride = 1;
let frameCount = 0;
let lastFaces: RawFace[] = [];

function post(message: unknown): void {
  self.postMessage(message);
}

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

function slimFaces(landmarks: { x: number; y: number }[][]): RawFace[] {
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
    const leftCheek = pointAt(faceLandmarks, FACE.leftCheek) ?? { x: Math.min(leftEye.x, rightEye.x) - faceH * 0.25, y: nosePoint.y };
    const rightCheek = pointAt(faceLandmarks, FACE.rightCheek) ?? { x: Math.max(leftEye.x, rightEye.x) + faceH * 0.25, y: nosePoint.y };
    faces.push({ forehead, chin, nose: nosePoint, leftEye, rightEye, leftCheek, rightCheek });
  }
  return faces;
}

function slimPoses(landmarks: { x: number; y: number; visibility?: number }[][]): RawPose[] {
  return landmarks.map((row) => ({
    landmarks: row.map((point) => ({
      x: point.x,
      y: point.y,
      visibility: point.visibility ?? 1,
    })),
  }));
}

async function freshVision(): Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> {
  const scope = self as typeof self & { ModuleFactory?: (module?: unknown) => Promise<unknown> };
  if (!factory) throw new Error("ModuleFactory not set");
  scope.ModuleFactory = factory;
  return FilesetResolver.forVisionTasks(wasmBase, true);
}

async function createPose(model: string, cpuOnly: boolean) {
  const options = {
    runningMode: "VIDEO" as const,
    numPoses: 2,
    minPoseDetectionConfidence: 0.35,
    minPosePresenceConfidence: 0.35,
    minTrackingConfidence: 0.35,
    outputSegmentationMasks: false,
  };
  const make = async (delegate: "CPU" | "GPU") => {
    const vision = await freshVision();
    return PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: model, delegate },
    });
  };
  if (cpuOnly) return make("CPU");
  try {
    return await make("GPU");
  } catch {
    cpuOnly = true;
    delegate = "CPU";
    return make("CPU");
  }
}

async function createFace(model: string, cpuOnly: boolean) {
  const options = {
    runningMode: "VIDEO" as const,
    numFaces: 2,
    minFaceDetectionConfidence: 0.3,
    minFacePresenceConfidence: 0.3,
    minTrackingConfidence: 0.3,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  };
  const make = async (useCpu: boolean) => {
    const vision = await freshVision();
    return FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: model, delegate: useCpu ? "CPU" : "GPU" },
    });
  };
  if (cpuOnly) return make(true);
  try {
    return await make(false);
  } catch {
    return make(true);
  }
}

let cpuOnly = false;
let wasmBase = "";
let poseModel = "";
let faceModel = "";
let factory: ((module?: unknown) => Promise<unknown>) | undefined;
let delegate: "CPU" | "GPU" = "CPU";
let faceError = "";
let rebuilding = false;

function closeModels(): void {
  pose?.close();
  face?.close();
  pose = null;
  face = null;
}

async function buildModels(forceCpu: boolean): Promise<void> {
  closeModels();
  cpuOnly = forceCpu || cpuOnly;
  delegate = cpuOnly ? "CPU" : "GPU";
  try {
    pose = await createPose(poseModel, cpuOnly);
  } catch (error) {
    throw new Error(`pose ${error instanceof Error ? error.message : String(error)}`);
  }
  if (cpuOnly) delegate = "CPU";
  try {
    face = await createFace(faceModel, cpuOnly);
    faceError = "";
  } catch (error) {
    face = null;
    faceError = error instanceof Error ? error.message : String(error);
    if (!cpuOnly) {
      cpuOnly = true;
      delegate = "CPU";
      face = await createFace(faceModel, true);
      faceError = "";
    }
  }
}

self.onmessage = async (event: MessageEvent<InitMessage | FrameMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      wasmBase = message.wasmPath.replace(/\/$/, "");
      poseModel = message.poseModel;
      faceModel = message.faceModel;
      const scope = self as typeof self & { ModuleFactory?: (module?: unknown) => Promise<unknown> };
      const imported = (await import(`${wasmBase}/vision_wasm_module_internal.js`)) as {
        default?: (module?: unknown) => Promise<unknown>;
      };
      // Safari's module worker does not keep the script's `globalThis.ModuleFactory` assignment.
      // The file also default-exports the factory, so install that onto the worker global ourselves.
      factory = imported.default ?? scope.ModuleFactory;
      if (typeof factory !== "function") {
        throw new Error(`factory missing keys=${Object.keys(imported).join(",") || "none"}`);
      }
      scope.ModuleFactory = factory;
      try {
        await buildModels(Boolean(message.cpuOnly));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(reason.startsWith("pose ") || reason.startsWith("face ") || reason.startsWith("fileset ") ? reason : `load ${reason}`);
      }
      post({ type: "ready", pose: true, face: face != null, faceError, delegate });
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (!pose || rebuilding) return;
  try {
    const image = imageFromPixels(message);
    if (message.timestamp > poseTime) poseTime = message.timestamp;
    else poseTime += 1;
    const started = performance.now();
    const poseResult = pose.detectForVideo(image, poseTime);
    frameCount += 1;
    const poseCount = poseResult.landmarks.length;
    if (face && (poseCount === 0 || frameCount % faceStride === 0)) {
      if (message.timestamp > faceTime) faceTime = message.timestamp;
      else faceTime += 1;
      const faceStarted = performance.now();
      lastFaces = slimFaces(face.detectForVideo(image, faceTime).faceLandmarks);
      const faceMs = performance.now() - faceStarted;
      faceStride = faceMs > 50 ? 2 : 1;
    }
    post({
      type: "result",
      faces: lastFaces,
      poses: slimPoses(poseResult.landmarks),
      inferenceMs: performance.now() - started,
      delegate,
      faceReady: face != null,
      frameWidth: message.width,
      frameHeight: message.height,
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    post({ type: "error", message: messageText });
    if (!cpuOnly && !rebuilding) {
      rebuilding = true;
      try {
        await buildModels(true);
        post({ type: "ready", pose: true, face: face != null, faceError, delegate: "CPU" });
      } catch (retryError) {
        post({ type: "error", message: retryError instanceof Error ? retryError.message : String(retryError) });
      } finally {
        rebuilding = false;
      }
    }
  }
};

function imageFromPixels(message: FrameMessage): ImageData {
  if (message.width < 2 || message.height < 2) throw new Error(`frame ${message.width}x${message.height}`);
  const pixels = new Uint8ClampedArray(message.buffer);
  if (pixels.length < message.width * message.height * 4) throw new Error("frame short");
  return new ImageData(pixels, message.width, message.height);
}
