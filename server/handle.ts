import { ASPECTS, type AspectId } from "../src/composition/types";
import { buildFramingPrompt, coerceFraming, extractJson, type LlmFraming } from "../src/composition/llm";

export type LlmEnv = {
  LLM_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
};

const SYSTEM = `You refine portrait crop boxes for a phone held by a friend. Reply with JSON only, no markdown:
{"box":{"x":number,"y":number,"w":number,"h":number},"primaryMove":"left"|"right"|"up"|"down"|"closer"|"back"|"tilt_left"|"tilt_right"|"hold","reasoning":string,"confidence":number}
Coordinates are normalized to the full image, origin top-left, y down.
The box must contain the whole head, with a little room above the hair, and the eyes near the upper third of the box.
Do not let a box edge cut knees, elbows, wrists, or ankles.
Pixel aspect (w*imageWidth)/(h*imageHeight) must match the requested aspect.
Prefer chest-up for 4:5 and 3:4, and a slightly longer framing for 9:16.
If the person is small in the frame, set primaryMove to "closer".
reasoning is one short sentence in the requested language. confidence is from 0 to 1.`;

export function llmConfigured(env: LlmEnv): boolean {
  return Boolean(env.LLM_API_KEY?.trim());
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function providerOf(env: LlmEnv): "openai" | "openai-compatible" | "anthropic" {
  const name = env.LLM_PROVIDER?.trim();
  if (name === "anthropic" || name === "openai" || name === "openai-compatible") return name;
  return env.LLM_BASE_URL?.trim() ? "openai-compatible" : "openai";
}

function modelOf(env: LlmEnv, provider: string): string {
  if (env.LLM_MODEL?.trim()) return env.LLM_MODEL.trim();
  if (provider === "anthropic") return "claude-3-5-haiku-latest";
  return "gpt-4o-mini";
}

type FrameBody = {
  imageDataUrl?: string;
  aspect?: string;
  imageWidth?: number;
  imageHeight?: number;
  locale?: string;
  subject?: {
    eyeX: number;
    eyeY: number;
    headTop: number;
    chinY: number;
    yaw: number;
    shouldersY: number | null;
    joints: { name: string; x: number; y: number }[];
  } | null;
  rulesBox?: { x: number; y: number; w: number; h: number };
};

function isAspect(value: string): value is AspectId {
  return value === "4:5" || value === "3:4" || value === "9:16";
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function textFromPayload(payload: unknown): string {
  const record = payload as {
    choices?: { message?: { content?: unknown } }[];
    content?: { text?: string }[];
  };
  const content = record.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "object" && part && "text" in part ? String(part.text ?? "") : "")).join("");
  }
  if (Array.isArray(record.content)) return record.content.map((part) => part.text ?? "").join("");
  return "";
}

async function callModel(env: LlmEnv, userText: string, dataUrl: string): Promise<LlmFraming> {
  const provider = providerOf(env);
  const model = modelOf(env, provider);
  const key = env.LLM_API_KEY?.trim() ?? "";
  let response: Response;
  if (provider === "anthropic") {
    const media = dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: media, data: base64 } },
              { type: "text", text: `${SYSTEM}\n\n${userText}` },
            ],
          },
        ],
      }),
    });
  } else {
    const base = (env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
    const modern = /gpt-[5-9]/.test(model);
    const messages = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
        ],
      },
    ];
    const body: Record<string, unknown> = { model, messages, temperature: 0.2 };
    if (modern) {
      body.max_completion_tokens = 500;
      body.reasoning_effort = "none";
    } else {
      body.max_tokens = 500;
      body.response_format = { type: "json_object" };
    }
    response = await fetchWithTimeout(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!response.ok && !modern) {
      delete body.response_format;
      response = await fetchWithTimeout(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    }
  }
  if (!response.ok) throw new Error(`llm_${response.status}`);
  const payload = (await response.json()) as unknown;
  const framing = coerceFraming(extractJson(textFromPayload(payload)));
  if (!framing) throw new Error("llm_parse");
  return framing;
}

export async function handleApi(request: Request, env: LlmEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, llm: llmConfigured(env) });
  }
  if (url.pathname !== "/api/frame") return json({ ok: false, error: "not_found" }, 404);
  if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!llmConfigured(env)) return json({ ok: false, error: "unconfigured" });

  const raw = await request.text();
  if (raw.length > 1_800_000) return json({ ok: false, error: "too_large" }, 413);
  let body: FrameBody;
  try {
    body = JSON.parse(raw) as FrameBody;
  } catch {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const dataUrl = body.imageDataUrl ?? "";
  if (!/^data:image\/(jpeg|jpg|png);base64,/i.test(dataUrl)) return json({ ok: false, error: "bad_image" }, 400);
  if (!body.aspect || !isAspect(body.aspect)) return json({ ok: false, error: "bad_aspect" }, 400);
  const imageWidth = Number(body.imageWidth);
  const imageHeight = Number(body.imageHeight);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return json({ ok: false, error: "bad_size" }, 400);
  const rulesBox = body.rulesBox ?? { x: 0, y: 0, w: 1, h: 1 };
  const prompt = buildFramingPrompt({
    aspect: body.aspect,
    aspectValue: ASPECTS[body.aspect],
    imageWidth,
    imageHeight,
    locale: body.locale || "zh-CN",
    subject: body.subject ?? null,
    rulesBox,
  });
  try {
    const framing = await callModel(env, prompt, dataUrl);
    return json({ ok: true, framing });
  } catch (error) {
    console.error("frame request failed", error instanceof Error ? error.message : "llm");
    return json({ ok: false, error: "llm_failed" });
  }
}
