import { describe, expect, it } from "vitest";
import { publicUrl } from "../src/vision/client";

const page = "https://baobao1996121.github.io/framing-cam/";

describe("GitHub Pages asset URLs", () => {
  it("keeps wasm and models under /framing-cam/", () => {
    expect(publicUrl("/framing-cam/", page, "vendor/wasm")).toBe(
      "https://baobao1996121.github.io/framing-cam/vendor/wasm",
    );
    expect(publicUrl("/framing-cam/", page, "vendor/models/face_landmarker.task")).toBe(
      "https://baobao1996121.github.io/framing-cam/vendor/models/face_landmarker.task",
    );
    expect(publicUrl("/framing-cam/", page, "vendor/models/pose_landmarker_lite.task")).toBe(
      "https://baobao1996121.github.io/framing-cam/vendor/models/pose_landmarker_lite.task",
    );
  });

  it("resolves the base from a page opened without a trailing slash", () => {
    expect(publicUrl("/framing-cam/", "https://baobao1996121.github.io/framing-cam", "favicon.svg")).toBe(
      "https://baobao1996121.github.io/framing-cam/favicon.svg",
    );
  });
});
