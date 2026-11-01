import { describe, expect, it } from "vitest";
import { assertSameOrigin, inferenceSize, mediaPipeReportedSize } from "../src/camera/pixels";

describe("inference frames", () => {
  it("shrinks the long edge and rejects an empty camera frame", () => {
    expect(inferenceSize(1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(inferenceSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(() => inferenceSize(0, 720)).toThrow(/0x720/);
  });

  it("matches the size MediaPipe would read, including a zero videoWidth", () => {
    expect(mediaPipeReportedSize({ videoWidth: 0, videoHeight: 0, width: 640, height: 480 })).toEqual({
      width: 0,
      height: 0,
    });
    expect(mediaPipeReportedSize({ width: 640, height: 480 })).toEqual({ width: 640, height: 480 });
  });

  it("refuses a model URL on another host", () => {
    expect(assertSameOrigin("https://framing-cam.netlify.app/", "/vendor/models/face_landmarker.task").pathname).toBe(
      "/vendor/models/face_landmarker.task",
    );
    expect(() => assertSameOrigin("https://framing-cam.netlify.app/", "https://cdn.jsdelivr.net/npm/x")).toThrow(/jsdelivr/);
    expect(() =>
      assertSameOrigin("https://framing-cam.netlify.app/", "https://storage.googleapis.com/mediapipe-models/x"),
    ).toThrow(/googleapis/);
  });
});
