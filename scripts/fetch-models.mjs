import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "public/vendor/models");
const files = [
  [
    "pose_landmarker_lite.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  ],
  [
    "face_landmarker.task",
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  ],
  [
    "selfie_multiclass_256x256.tflite",
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite",
  ],
];

mkdirSync(dir, { recursive: true });
for (const [name, url] of files) {
  const dest = join(dir, name);
  if (existsSync(dest) && statSync(dest).size > 1_000_000) {
    console.log("keep", name);
    continue;
  }
  console.log("download", name);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`failed ${url}: ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(dest));
}
