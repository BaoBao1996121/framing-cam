import { FaceLandmarker, FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { RawFace, RawPoint, RawPose } from "../composition/subject";

type InitMessage = { type: "init"; wasmPath: string; poseModel: string; faceModel: string };
type FrameMessage = { type: "frame"; bitmap: ImageBitmap; timestamp: number };

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
    const forehead = pointAt(faceLandmarks, FACE.forehead);
    const chin = pointAt(faceLandmarks, FACE.chin);
    const nose = pointAt(faceLandmarks, FACE.nose);
    const leftEye = centroid(faceLandmarks, FACE.leftEye);
    const rightEye = centroid(faceLandmarks, FACE.rightEye);
    const leftCheek = pointAt(faceLandmarks, FACE.leftCheek);
    const rightCheek = pointAt(faceLandmarks, FACE.rightCheek);
    if (!forehead || !chin || !nose || !leftEye || !rightEye || !leftCheek || !rightCheek) continue;
    faces.push({ forehead, chin, nose, leftEye, rightEye, leftCheek, rightCheek });
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

async function createPose(vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, model: string) {
  const options = {
    runningMode: "VIDEO" as const,
    numPoses: 2,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  };
  try {
    return await PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: model, delegate: "GPU" },
    });
  } catch {
    return PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: model, delegate: "CPU" },
    });
  }
}

async function createFace(vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>, model: string) {
  const options = {
    runningMode: "VIDEO" as const,
    numFaces: 2,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  };
  try {
    return await FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: model, delegate: "GPU" },
    });
  } catch {
    return FaceLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: model, delegate: "CPU" },
    });
  }
}

self.onmessage = async (event: MessageEvent<InitMessage | FrameMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      // Module workers have no importScripts. The ES module build publishes ModuleFactory on globalThis.
      const wasmBase = message.wasmPath.replace(/\/$/, "");
      // The loader clears ModuleFactory after the first task, so keep the factory and restore it for the face model.
      const scope = self as typeof self & { ModuleFactory?: (module?: unknown) => Promise<unknown> };
      await import(`${wasmBase}/vision_wasm_module_internal.js`);
      const factory = scope.ModuleFactory;
      const vision = await FilesetResolver.forVisionTasks(wasmBase, true);
      pose = await createPose(vision, message.poseModel);
      let faceError = "";
      try {
        scope.ModuleFactory = factory;
        const faceVision = await FilesetResolver.forVisionTasks(wasmBase, true);
        face = await createFace(faceVision, message.faceModel);
      } catch (error) {
        face = null;
        faceError = error instanceof Error ? error.message : String(error);
      }
      post({ type: "ready", pose: true, face: face != null, faceError });
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const bitmap = message.bitmap;
  if (!pose) {
    bitmap.close();
    return;
  }
  try {
    if (message.timestamp > poseTime) poseTime = message.timestamp;
    else poseTime += 1;
    const started = performance.now();
    const poseResult = pose.detectForVideo(bitmap, poseTime);
    frameCount += 1;
    if (face && frameCount % faceStride === 0) {
      if (message.timestamp > faceTime) faceTime = message.timestamp;
      else faceTime += 1;
      const faceStarted = performance.now();
      lastFaces = slimFaces(face.detectForVideo(bitmap, faceTime).faceLandmarks);
      if (performance.now() - faceStarted > 45) faceStride = 2;
      else faceStride = 1;
    }
    post({
      type: "result",
      faces: lastFaces,
      poses: slimPoses(poseResult.landmarks),
      inferenceMs: performance.now() - started,
    });
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    bitmap.close();
  }
};
