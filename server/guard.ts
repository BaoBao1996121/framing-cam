export type RateBucket = { count: number; reset: number };

const buckets = new Map<string, RateBucket>();

export function originAllowed(origin: string | null, allowlist: string[], allowLocalhost = false): boolean {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, "");
  if (allowlist.some((item) => item.replace(/\/$/, "") === normalized)) return true;
  if (!allowLocalhost) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized);
}

export function allowLocalhost(env: { FRAME_ALLOW_LOCALHOST?: string }): boolean {
  return env.FRAME_ALLOW_LOCALHOST === "1";
}

const BODY_CAP = 1_800_000;

/** Read the body, stopping once it passes the cap. A missing content-length still cannot grow without bound. */
export async function readLimitedBody(request: Request, max = BODY_CAP): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const reader = request.body?.getReader();
  if (!reader) {
    const text = await request.text();
    return text.length > max ? null : text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export function allowlistFromEnv(raw: string | undefined): string[] {
  const extra = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ["https://framing-cam.netlify.app", "https://baobao1996121.github.io", ...extra];
}

/** True when the caller is still inside the quota. */
export function pruneRates(now: number, store = buckets): void {
  for (const [key, bucket] of store) {
    if (now >= bucket.reset) store.delete(key);
  }
}

export function allowRate(ip: string, now: number, limit = 8, windowMs = 60_000, store = buckets): boolean {
  pruneRates(now, store);
  const key = ip || "anonymous";
  const current = store.get(key);
  if (!current || now >= current.reset) {
    store.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function firstAddress(value: string | null): string {
  return value?.split(",")[0]?.trim() || "";
}

export function clientIp(request: Request): string {
  const real = firstAddress(request.headers.get("x-real-ip"));
  if (real) return real;
  const vercel = firstAddress(request.headers.get("x-vercel-forwarded-for"));
  if (vercel) return vercel;
  const netlify = request.headers.get("x-nf-client-connection-ip")?.trim();
  return netlify || "anonymous";
}

export function safeSubject(value: unknown): Record<string, number | string | null | { name: string; x: number; y: number }[]> | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const num = (item: unknown): number | null => (typeof item === "number" && Number.isFinite(item) ? Math.round(item * 1000) / 1000 : null);
  const jointsIn = Array.isArray(raw.joints) ? raw.joints.slice(0, 16) : [];
  const joints = jointsIn.flatMap((joint) => {
    if (!joint || typeof joint !== "object") return [];
    const item = joint as Record<string, unknown>;
    const name = clampText(item.name, 12, "");
    const x = num(item.x);
    const y = num(item.y);
    if (!name || x == null || y == null) return [];
    return [{ name, x, y }];
  });
  return {
    eyeX: num(raw.eyeX),
    eyeY: num(raw.eyeY),
    headTop: num(raw.headTop),
    chinY: num(raw.chinY),
    yaw: num(raw.yaw),
    shouldersY: num(raw.shouldersY),
    joints,
  };
}

export function clampText(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return fallback;
  return cleaned.slice(0, max);
}
