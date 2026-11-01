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
    test.setTimeout(90_000);
    await page.waitForFunction(() => {
      const guidance = document.body.dataset.guidance || "";
      const prompt = document.body.dataset.prompt || "";
      return document.body.dataset.screen === "live" && guidance !== "" && guidance !== "searching" && prompt !== "";
    });
    const before = await page.evaluate(() => ({
      guidance: document.body.dataset.guidance || "",
      prompt: document.body.dataset.prompt || "",
      shoot: document.body.dataset.shoot || "other",
    }));
    expect(before.shoot).toBe(mode);
    const phrases: Record<string, string> =
      mode === "self"
        ? {
            left: "脸往左一点",
            right: "脸往右一点",
            up: "手机举高一点",
            down: "手机放低一点",
            closer: "靠近一点",
            back: "离远一点",
            raiseLeft: "左边抬高",
            raiseRight: "右边抬高",
            steady: "别动",
            ready: "准备拍",
          }
        : {
            left: "手机往左",
            right: "手机往右",
            up: "手机抬高一点",
            down: "手机放低一点",
            closer: "往前走一步",
            back: "后退一步",
            raiseLeft: "左边抬高",
            raiseRight: "右边抬高",
            steady: "稳住",
            ready: "好了",
          };
    expect(before.prompt === phrases[before.guidance] || before.prompt.startsWith(`${phrases[before.guidance]}，`)).toBe(true);
    const trace = await page.evaluate(async () => {
      const host = window as unknown as { __spot: { x: number; y: number; w: number; h: number } };
      const deadline = performance.now() + 40000;
      const seen: string[] = [];
      let last = "";
      while (performance.now() < deadline && document.body.dataset.captured !== "1") {
        const hint = document.body.dataset.guidance || "";
        if (seen[seen.length - 1] !== hint) seen.push(hint);
        last = `${seen.join(">")} ${document.body.dataset.subject || ""}`;
        const spot = host.__spot;
        if (hint === "left") spot.x += 3;
        else if (hint === "right") spot.x -= 3;
        else if (hint === "up") spot.y += 3;
        else if (hint === "down") spot.y -= 3;
        else if (hint === "closer" || hint === "back") {
          const cx = spot.x + spot.w / 2;
          const cy = spot.y + spot.h / 2;
          const scale = hint === "closer" ? 1.012 : 0.988;
          spot.w *= scale;
          spot.h *= scale;
          spot.x = cx - spot.w / 2;
          spot.y = cy - spot.h / 2;
        }
        spot.x = Math.max(0, Math.min(480 - spot.w, spot.x));
        spot.y = Math.max(0, Math.min(640 - spot.h, spot.y));
        spot.w = Math.max(80, Math.min(460, spot.w));
        spot.h = Math.max(100, Math.min(620, spot.h));
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
      return last;
    });
    console.log(mode, before.guidance, before.prompt, trace);
    await page.waitForFunction(() => document.body.dataset.captured === "1", undefined, { timeout: 5_000 });
    const after = await page.evaluate(() => ({
      screen: document.body.dataset.screen,
      status: document.getElementById("vision-status")?.hidden ? "" : document.getElementById("vision-status")?.textContent || "",
      still: document.body.dataset.still || "",
      stillFrom: document.body.dataset.stillFrom || "",
    }));
    expect(after.screen).toBe("review");
    expect(after.status).not.toMatch(/document/);
    expect(after.stillFrom).toBe("painted-frame");
    expect(modelMs).toBeLessThan(45_000);
    console.log(`${mode} model-ready ${modelMs}ms still ${after.still} from ${after.stillFrom}`);
    test.info().annotations.push({ type: "still", description: after.still });
  });
}

test("subject leaves: guidance drops and the shutter does not fire", async ({ page, browserName }) => {
  test.skip(browserName !== "webkit", "The phone path is WebKit.");
  test.setTimeout(90_000);
  await page.goto("/?probe=1&fakecam=frames");
  await page.waitForFunction(() => document.body.dataset.model === "ready");
  await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.querySelector("#demo");
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2d");
    const host = window as unknown as { __spot: { x: number; y: number; w: number; h: number }; __hide?: boolean };
    host.__spot = { x: 80, y: 40, w: 280, h: 360 };
    const paint = () => {
      context.fillStyle = "#d9cbb8";
      context.fillRect(0, 0, canvas.width, canvas.height);
      if (!host.__hide) {
        const spot = host.__spot;
        context.drawImage(image, spot.x, spot.y, spot.w, spot.h);
      }
      requestAnimationFrame(paint);
    };
    paint();
  }, faceUrl);
  await page.waitForFunction(() => document.getElementById("open-camera")?.textContent?.includes("打开"));
  await page.locator("#open-camera").click();
  await page.waitForFunction(() => {
    const guidance = document.body.dataset.guidance || "";
    return document.body.dataset.screen === "live" && guidance !== "" && guidance !== "searching";
  });
  await page.evaluate(() => {
    (window as unknown as { __hide?: boolean }).__hide = true;
  });
  await page.waitForFunction(() => document.body.dataset.guidance === "searching");
  const after = await page.evaluate(() => ({
    captured: document.body.dataset.captured || "",
    prompt: document.body.dataset.prompt || "",
  }));
  expect(after.captured).not.toBe("1");
  expect(after.prompt).toBe("找人");
});
