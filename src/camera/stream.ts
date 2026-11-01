import { inferenceSize } from "./pixels";

export type Facing = "environment" | "user";

export async function attachCamera(video: HTMLVideoElement, facing: Facing): Promise<MediaStream> {
  const fake = new URLSearchParams(location.search).get("fakecam");
  if (fake) {
    video.src = fake;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    await waitForVideoSize(video, 4000);
    return new MediaStream();
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  await video.play();
  await waitForVideoSize(video, 2000);
  return stream;
}

function waitForVideoSize(video: HTMLVideoElement, ms: number): Promise<void> {
  if (video.videoWidth >= 2 && video.videoHeight >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (video.videoWidth < 2 || video.videoHeight < 2) return;
      cleanup();
      resolve();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", done);
      video.removeEventListener("resize", done);
    };
    video.addEventListener("loadedmetadata", done);
    video.addEventListener("resize", done);
    video.requestVideoFrameCallback?.(() => done());
  });
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Copy the camera (or a canvas) into pixels. ImageBitmap is not used: Safari reports its videoWidth as 0. */
export function grabInferencePixels(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): ImageData {
  const size = inferenceSize(sourceWidth, sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("frame");
  context.drawImage(source, 0, 0, size.width, size.height);
  return context.getImageData(0, 0, size.width, size.height);
}
