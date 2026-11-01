import { expect, test } from "@playwright/test";

test("a still is the photo size, then cropped, not the 960 preview", async ({ page, browserName }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const still = await import("/src/camera/still.ts");
    const capture = await import("/src/ui/capture.ts");
    const geometry = await import("/src/composition/geometry.ts");
    class FakeCapture {
      async takePhoto(): Promise<Blob> {
        const canvas = document.createElement("canvas");
        canvas.width = 3000;
        canvas.height = 4000;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2d");
        for (let index = 0; index < 48; index += 1) {
          context.fillStyle = index % 2 === 0 ? "#222" : "#eee";
          context.fillRect((index * 61) % 3000, (index * 83) % 4000, 36, 36);
        }
        const blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("blob"))), "image/jpeg", 0.92);
        });
        return blob;
      }
    }
    (globalThis as unknown as { ImageCapture: typeof FakeCapture }).ImageCapture = FakeCapture;
    const track = {
      kind: "video",
      getCapabilities: () => ({ width: { max: 4000 }, height: { max: 3000 } }),
      applyConstraints: async () => undefined,
    } as unknown as MediaStreamTrack;
    const video = document.createElement("video");
    const photo = await still.stillFromVideo(video, track);
    const leveled = still.shouldLevel(2) ? still.applyLevel(photo, photo.width, photo.height, 2) : photo;
    const crop = still.insetCrop(
      geometry.frameAroundTarget({ x: 0.3, y: 0.22, w: 0.4, h: 0.34 }, 4 / 5, leveled.width, leveled.height),
      2,
    );
    const output = capture.renderCrop(leveled, leveled.width, leveled.height, crop, false);
    return {
      still: `${photo.width}x${photo.height}`,
      output: `${output.width}x${output.height}`,
      preview: `${still.PREVIEW_WIDTH}x${still.PREVIEW_HEIGHT}`,
    };
  });
  const [stillW, stillH] = result.still.split("x").map(Number);
  const [outW, outH] = result.output.split("x").map(Number);
  expect(stillW).toBe(3000);
  expect(stillH).toBe(4000);
  expect(Math.max(outW, outH)).toBeGreaterThan(1280);
  expect(Math.abs(outW / outH - 4 / 5)).toBeLessThan(0.02);
  expect(result.preview).toBe("960x540");
  test.info().annotations.push({
    type: "resolution",
    description: `${browserName} still ${result.still} output ${result.output} preview ${result.preview}`,
  });
  console.log(`${browserName} still ${result.still} output ${result.output} preview ${result.preview}`);
});
