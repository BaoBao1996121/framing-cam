import { Detectors, type VisionPaths } from "./runtime";

type InitMessage = { type: "init" } & VisionPaths;
type FrameMessage = { type: "frame"; width: number; height: number; buffer: ArrayBuffer; timestamp: number };

let detectors: Detectors | null = null;
let paths: VisionPaths | null = null;
let rebuilding = false;

function post(message: unknown): void {
  self.postMessage(message);
}

function imageFromPixels(message: FrameMessage): ImageData {
  if (message.width < 2 || message.height < 2) throw new Error(`frame ${message.width}x${message.height}`);
  const pixels = new Uint8ClampedArray(message.buffer);
  if (pixels.length < message.width * message.height * 4) throw new Error("frame short");
  return new ImageData(pixels, message.width, message.height);
}

self.onmessage = async (event: MessageEvent<InitMessage | FrameMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      detectors?.close();
      paths = message;
      detectors = await Detectors.create(message);
      post({
        type: "ready",
        pose: true,
        face: detectors.faceReady,
        faceError: detectors.faceError,
        delegate: detectors.delegate,
      });
    } catch (error) {
      post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (!detectors || rebuilding) return;
  try {
    const found = detectors.detect(imageFromPixels(message), message.timestamp);
    post({ type: "result", ...found });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    post({ type: "error", message: messageText });
    if (detectors.delegate !== "CPU" && paths && !rebuilding) {
      rebuilding = true;
      try {
        detectors.close();
        detectors = await Detectors.create({ ...paths, cpuOnly: true });
        post({
          type: "ready",
          pose: true,
          face: detectors.faceReady,
          faceError: detectors.faceError,
          delegate: "CPU",
        });
      } catch (retryError) {
        post({ type: "error", message: retryError instanceof Error ? retryError.message : String(retryError) });
      } finally {
        rebuilding = false;
      }
    }
  }
};
