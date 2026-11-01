import { describe, expect, it } from "vitest";
import { insetCrop, maxPhotoSize, previewConstraints, rollInset, shouldLevel } from "../src/camera/still";

describe("still capture", () => {
  it("keeps the live analysis stream below a full-sensor still", () => {
    const video = previewConstraints("environment").video;
    expect(video.width.ideal).toBeLessThanOrEqual(960);
    expect(video.height.ideal).toBeLessThanOrEqual(540);
  });

  it("reads the largest size the track advertises", () => {
    expect(maxPhotoSize(null)).toBeNull();
    expect(maxPhotoSize({ getCapabilities: () => ({ width: { max: 4032 }, height: { max: 3024 } }) })).toEqual({
      width: 4032,
      height: 3024,
    });
  });

  it("levels only a small tilt and insets the crop to hide the corners", () => {
    expect(shouldLevel(0.2)).toBe(false);
    expect(shouldLevel(2.5)).toBe(true);
    expect(shouldLevel(12)).toBe(false);
    expect(rollInset(null)).toBe(0);
    expect(rollInset(2)).toBeGreaterThan(0);
    expect(rollInset(2)).toBeLessThan(0.03);
    const crop = insetCrop({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, 2);
    expect(crop.w).toBeLessThan(0.8);
    expect(crop.x).toBeGreaterThan(0.1);
  });
});
