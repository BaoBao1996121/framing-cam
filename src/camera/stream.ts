export type Facing = "environment" | "user";

export async function attachCamera(video: HTMLVideoElement, facing: Facing): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 3840 },
      height: { ideal: 2160 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
  video.srcObject = stream;
  video.playsInline = true;
  video.muted = true;
  await video.play();
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() as { width?: { max?: number }; height?: { max?: number } } | undefined;
  if (caps?.width?.max && caps.height?.max) {
    try {
      await track.applyConstraints({
        width: { ideal: caps.width.max },
        height: { ideal: caps.height.max },
        frameRate: { ideal: 30, max: 30 },
      });
    } catch {
      /* The initial stream is already the browser's best effort. */
    }
  }
  return stream;
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function grabInferenceBitmap(video: HTMLVideoElement): Promise<ImageBitmap> {
  const longest = Math.max(video.videoWidth, video.videoHeight);
  const scale = longest > 960 ? 960 / longest : 1;
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  try {
    return await createImageBitmap(video, { resizeWidth: width, resizeHeight: height, resizeQuality: "low" });
  } catch {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("frame");
    context.drawImage(video, 0, 0, width, height);
    return createImageBitmap(canvas);
  }
}
