import type { AspectId } from "../src/composition/types";
import { buildPlansPrompt, PLANS_SYSTEM } from "../src/plans/prompt";
import { repairPlansFromText } from "../src/plans/validate";
import type { Rect } from "../src/composition/types";
import { allowlistFromEnv, allowLocalhost, allowRate, clampText, clientIp, originAllowed, safeSubject } from "./guard";

export type LlmEnv = {
  LLM_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_MODEL?: string;
  FRAME_ORIGINS?: string;
  FRAME_ALLOW_LOCALHOST?: string;
  NODE_ENV?: string;
};

const SYSTEM = PLANS_SYSTEM;

export function llmConfigured(env: LlmEnv): boolean {
  return Boolean(env.LLM_API_KEY?.trim());
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export type LlmTarget = {
  /** Value of LLM_PROVIDER after aliases, or the inferred default. */
  provider: string;
  wire: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  /** Volcengine seed models reason by default; turn that off for a short JSON crop. */
  disableThinking: boolean;
};

const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DOUBAO_BASE = "https://ark.cn-beijing.volces.com/api/v3";

export function resolveLlmTarget(env: LlmEnv): LlmTarget {
  const raw = env.LLM_PROVIDER?.trim().toLowerCase() || "";
  const alias =
    raw === "qwen" || raw === "qwen-vl" ? "dashscope" : raw === "volcengine" || raw === "ark" ? "doubao" : raw;
  const overrideBase = env.LLM_BASE_URL?.trim().replace(/\/$/, "") || "";
  const overrideModel = env.LLM_MODEL?.trim() || "";

  if (alias === "anthropic") {
    return {
      provider: "anthropic",
      wire: "anthropic",
      baseUrl: overrideBase || "https://api.anthropic.com/v1",
      model: overrideModel || "claude-3-5-haiku-latest",
      disableThinking: false,
    };
  }
  if (alias === "dashscope") {
    return {
      provider: "dashscope",
      wire: "openai",
      baseUrl: overrideBase || DASHSCOPE_BASE,
      model: overrideModel || "qwen-vl-max",
      disableThinking: false,
    };
  }
  if (alias === "doubao") {
    return {
      provider: "doubao",
      wire: "openai",
      baseUrl: overrideBase || DOUBAO_BASE,
      model: overrideModel || "doubao-seed-2-1-pro-260628",
      disableThinking: true,
    };
  }
  const provider = alias === "openai" || alias === "openai-compatible" ? alias : overrideBase ? "openai-compatible" : "openai";
  return {
    provider,
    wire: "openai",
    baseUrl: overrideBase || "https://api.openai.com/v1",
    model: overrideModel || "gpt-4o-mini",
    disableThinking: false,
  };
}

type FrameBody = {
  imageDataUrl?: string;
  aspect?: string;
  imageWidth?: number;
  imageHeight?: number;
  locale?: string;
  style?: string;
  rollDeg?: number | null;
  zoom?: { min?: number; max?: number; current?: number };
  subject?: {
    box?: Rect | null;
    eyeX?: number;
    eyeY?: number;
    headTop?: number;
    chinY?: number;
    yaw?: number;
    shouldersY?: number | null;
    joints?: { name: string; x: number; y: number }[];
  } | null;
  rulesBox?: Rect;
};

function isAspect(value: string): value is AspectId {
  return value === "4:5" || value === "3:4" || value === "9:16";
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 9000): Promise<Response> {
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

async function callModel(env: LlmEnv, userText: string, dataUrl: string): Promise<string> {
  const target = resolveLlmTarget(env);
  const key = env.LLM_API_KEY?.trim() ?? "";
  let response: Response;
  if (target.wire === "anthropic") {
    const media = dataUrl.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    response = await fetchWithTimeout(`${target.baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: target.model,
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
    const modern = /gpt-[5-9]/.test(target.model);
    const jsonMode = target.provider === "openai" || target.provider === "openai-compatible";
    const messages = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: jsonMode ? { url: dataUrl, detail: "low" } : { url: dataUrl } },
        ],
      },
    ];
    const body: Record<string, unknown> = { model: target.model, messages, temperature: 0.2 };
    if (target.disableThinking) body.thinking = { type: "disabled" };
    if (modern) {
      body.max_completion_tokens = 500;
      body.reasoning_effort = "none";
    } else {
      body.max_tokens = 500;
      if (jsonMode) body.response_format = { type: "json_object" };
    }
    const headers = { "content-type": "application/json", authorization: `Bearer ${key}` };
    response = await fetchWithTimeout(`${target.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok && body.response_format) {
      delete body.response_format;
      response = await fetchWithTimeout(`${target.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    }
  }
  if (!response.ok) throw new Error(`llm_${response.status}`);
  const payload = (await response.json()) as unknown;
  const text = textFromPayload(payload);
  if (!text.trim()) throw new Error("llm_parse");
  return text;
}

function pathnameOf(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    const raw = request.url || "/";
    const path = raw.split("?")[0] || "/";
    return path.startsWith("/") ? path : `/${path}`;
  }
}

export async function handleApi(request: Request, env: LlmEnv): Promise<Response> {
  const pathname = pathnameOf(request);
  if ((pathname === "/api/health" || pathname.endsWith("/api/health")) && request.method === "GET") {
    return json({ ok: true, llm: llmConfigured(env) });
  }
  if (pathname !== "/api/frame" && !pathname.endsWith("/api/frame")) return json({ ok: false, error: "not_found" }, 404);
  if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!originAllowed(request.headers.get("origin"), allowlistFromEnv(env.FRAME_ORIGINS), allowLocalhost(env))) {
    return json({ ok: false, error: "origin" }, 403);
  }
  if (!llmConfigured(env)) return json({ ok: false, error: "unconfigured" });
  if (!allowRate(clientIp(request), Date.now())) return json({ ok: false, error: "rate" }, 429);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > 1_800_000) return json({ ok: false, error: "too_large" }, 413);

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
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth < 2 || imageHeight < 2 || imageWidth > 8000 || imageHeight > 8000) {
    return json({ ok: false, error: "bad_size" }, 400);
  }
  const style = clampText(body.style, 80, "自然");
  const locale = clampText(body.locale, 16, "zh-CN");
  const subjectBox = body.subject?.box && typeof body.subject.box === "object" ? body.subject.box : null;
  const zoom = {
    min: Math.min(10, Math.max(1, Number(body.zoom?.min ?? 1) || 1)),
    max: Math.min(10, Math.max(1, Number(body.zoom?.max ?? 1) || 1)),
    current: Math.min(10, Math.max(1, Number(body.zoom?.current ?? 1) || 1)),
  };
  const prompt = buildPlansPrompt({
    style,
    locale,
    aspect: body.aspect,
    imageWidth,
    imageHeight,
    rollDeg: typeof body.rollDeg === "number" ? body.rollDeg : null,
    zoom,
    subject: safeSubject(body.subject ?? null),
  });
  try {
    const text = await callModel(env, prompt, dataUrl);
    const plans = repairPlansFromText(text, { style, locale, subjectBox });
    if (plans.length < 2) return json({ ok: false, error: "llm_parse" });
    return json({ ok: true, plans });
  } catch (error) {
    console.error("frame request failed", error instanceof Error ? error.message : "llm");
    return json({ ok: false, error: "llm_failed" });
  }
}
