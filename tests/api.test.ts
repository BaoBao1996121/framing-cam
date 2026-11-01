import { describe, expect, it } from "vitest";
import { buildFramingPrompt } from "../src/composition/llm";
import { handleApi } from "../server/handle";

describe("framing API", () => {
  it("reports that no key means rules-only", async () => {
    const response = await handleApi(new Request("http://local/api/health"), {});
    expect(await response.json()).toEqual({ ok: true, llm: false });
  });

  it("refuses a frame call when no key is configured", async () => {
    const response = await handleApi(
      new Request("http://local/api/frame", {
        method: "POST",
        body: JSON.stringify({ imageDataUrl: "data:image/jpeg;base64,aaaa", aspect: "4:5", imageWidth: 10, imageHeight: 10 }),
      }),
      {},
    );
    expect(await response.json()).toMatchObject({ ok: false, error: "unconfigured" });
  });

  it("mentions the aspect and the subject in the model prompt", () => {
    const prompt = buildFramingPrompt({
      aspect: "4:5",
      aspectValue: 0.8,
      imageWidth: 800,
      imageHeight: 1000,
      locale: "zh-CN",
      subject: { eyeX: 0.4, eyeY: 0.3, headTop: 0.2, chinY: 0.4, yaw: 0, shouldersY: 0.5, joints: [] },
      rulesBox: { x: 0, y: 0, w: 1, h: 1 },
    });
    expect(prompt).toContain("4:5");
    expect(prompt).toContain("Simplified Chinese");
    expect(prompt).toContain("0.4");
  });
});
