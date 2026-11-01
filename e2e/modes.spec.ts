import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const faceUrl = `data:image/jpeg;base64,${readFileSync(new URL("./fixtures/face.jpg", import.meta.url)).toString("base64")}`;
const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";

test.use({ userAgent: iphone, viewport: { width: 390, height: 844 } });

for (const mode of ["other", "self"] as const) {
  test(`${mode}: model, person, instruction, then capture`, async ({ page, browserName }) => {
    test.skip(browserName !== "webkit", "The phone path is WebKit.");
    const started = Date.now();
    const query = mode === "self" ? "mode=self&" : "";
    await page.goto(`/?${query}probe=1&fakecam=frames`);
    await page.waitForFunction(() => document.body.dataset.model === "ready");
    const modelMs = Date.now() - started;
    await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.querySelector("#demo");
      if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas");
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2d");
      const host = window as unknown as { __spot: { x: number; y: number; w: number; h: number } };
      host.__spot = { x: 8, y: 40, w: 280, h: 360 };
      const paint = () => {
        const spot = host.__spot;
        context.fillStyle = "#d9cbb8";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, spot.x, spot.y, spot.w, spot.h);
        requestAnimationFrame(paint);
      };
      paint();
    }, faceUrl);
    await page.waitForFunction(() => document.getElementById("open-camera")?.textContent?.includes("打开"));
    await page.locator("#open-camera").click();
    await page.waitForFunction(() => {
      const guidance = document.body.dataset.guidance || "";
      const prompt = document.body.dataset.prompt || "";
      return document.body.dataset.screen === "live" && guidance !== "" && guidance !== "searching" && guidance !== "ready" && prompt !== "";
    });
    const before = await page.evaluate(() => ({
      guidance: document.body.dataset.guidance,
      prompt: document.body.dataset.prompt,
      shoot: document.body.dataset.shoot || "other",
    }));
    expect(before.shoot).toBe(mode);
    expect(before.prompt).toBe(mode === "self" ? "脸往左一点" : "手机往左");
    await page.evaluate(() => {
      (window as unknown as { __spot: { x: number; y: number; w: number; h: number } }).__spot = { x: 80, y: 40, w: 280, h: 360 };
    });
    await page.waitForFunction(() => document.body.dataset.captured === "1");
    const after = await page.evaluate(() => ({
      screen: document.body.dataset.screen,
      status: document.getElementById("vision-status")?.hidden ? "" : document.getElementById("vision-status")?.textContent || "",
      still: document.body.dataset.still || "",
    }));
    expect(after.screen).toBe("review");
    expect(after.status).not.toMatch(/document/);
    expect(modelMs).toBeLessThan(45_000);
    console.log(`${mode} model-ready ${modelMs}ms still ${after.still}`);
    test.info().annotations.push({ type: "still", description: after.still });
  });
}
