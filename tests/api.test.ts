import { describe, expect, it } from "vitest";
import { shouldProbeCloud } from "../src/cloud/client";
import { buildFramingPrompt } from "../src/composition/llm";
import { toRequest } from "../api/health";
import { handleApi, resolveLlmTarget } from "../server/handle";

describe("framing API", () => {
  it("keeps Origin when the Vercel adapter builds a Request", async () => {
    const request = await toRequest({
      method: "POST",
      url: "/api/frame",
      headers: {
        origin: "https://framing-cam.netlify.app",
        "content-type": "application/json",
        "x-nf-client-connection-ip": "198.51.100.8",
      },
      body: "{}",
    });
    expect(request.headers.get("origin")).toBe("https://framing-cam.netlify.app");
    expect(request.headers.get("x-nf-client-connection-ip")).toBe("198.51.100.8");
  });

  it("reports that no key means rules-only", async () => {
    const response = await handleApi(new Request("http://local/api/health"), {});
    expect(await response.json()).toEqual({ ok: true, llm: false });
  });

  it("refuses localhost in production and ignores a spoofed forwarded-for", async () => {
    const blocked = await handleApi(
      new Request("http://local/api/frame", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:5199" },
        body: "{}",
      }),
      { NODE_ENV: "production", LLM_API_KEY: "test-key" },
    );
    expect(blocked.status).toBe(403);
    let allowed = 0;
    for (let index = 0; index < 12; index += 1) {
      const response = await handleApi(
        new Request("http://local/api/frame", {
          method: "POST",
          headers: { origin: "https://framing-cam.netlify.app", "x-forwarded-for": `203.0.113.${index}` },
          body: "{",
        }),
        { NODE_ENV: "production", LLM_API_KEY: "test-key" },
      );
      if (response.status !== 429) allowed += 1;
    }
    expect(allowed).toBeLessThanOrEqual(8);
  });

  it("rejects a foreign origin and limits repeated frame calls", async () => {
    const env = { LLM_API_KEY: "test-key" };
    const denied = await handleApi(
      new Request("http://local/api/frame", {
        method: "POST",
        headers: { origin: "https://evil.example", "x-forwarded-for": "203.0.113.9" },
        body: "{}",
      }),
      env,
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ ok: false, error: "origin" });

    const headers = { origin: "http://127.0.0.1:5199", "x-nf-client-connection-ip": "203.0.113.10" };
    let limited = 0;
    for (let index = 0; index < 9; index += 1) {
      const response = await handleApi(new Request("http://local/api/frame", { method: "POST", headers, body: "{" }), env);
      if (response.status === 429) limited += 1;
    }
    expect(limited).toBe(1);
  });

  it("refuses a frame call when no key is configured", async () => {
    const response = await handleApi(
      new Request("http://local/api/frame", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:5199" },
        body: JSON.stringify({ imageDataUrl: "data:image/jpeg;base64,aaaa", aspect: "4:5", imageWidth: 10, imageHeight: 10 }),
      }),
      {},
    );
    expect(await response.json()).toMatchObject({ ok: false, error: "unconfigured" });
  });

  it("presets DashScope Qwen-VL and Volcengine Doubao, and lets env override them", () => {
    expect(resolveLlmTarget({ LLM_PROVIDER: "dashscope" })).toMatchObject({
      provider: "dashscope",
      wire: "openai",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-vl-max",
    });
    expect(resolveLlmTarget({ LLM_PROVIDER: "qwen-vl" }).model).toBe("qwen-vl-max");
    expect(resolveLlmTarget({ LLM_PROVIDER: "doubao" })).toMatchObject({
      provider: "doubao",
      wire: "openai",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
      model: "doubao-seed-2-1-pro-260628",
      disableThinking: true,
    });
    expect(resolveLlmTarget({ LLM_PROVIDER: "volcengine", LLM_MODEL: "ep-demo" })).toMatchObject({
      provider: "doubao",
      model: "ep-demo",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });
    expect(
      resolveLlmTarget({
        LLM_PROVIDER: "dashscope",
        LLM_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/",
        LLM_MODEL: "qwen-vl-plus",
      }).baseUrl,
    ).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
  });

  it("probes the cloud endpoint on Netlify and in dev, not on the Pages build", () => {
    expect(shouldProbeCloud(false, undefined)).toBe(false);
    expect(shouldProbeCloud(false, "1")).toBe(true);
    expect(shouldProbeCloud(true, undefined)).toBe(true);
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
