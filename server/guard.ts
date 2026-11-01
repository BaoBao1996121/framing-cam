export type RateBucket = { count: number; reset: number };

const buckets = new Map<string, RateBucket>();

export function originAllowed(origin: string | null, allowlist: string[]): boolean {
  if (!origin) return false;
  const normalized = origin.replace(/\/$/, "");
  if (allowlist.some((item) => item.replace(/\/$/, "") === normalized)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized);
}

export function allowlistFromEnv(raw: string | undefined): string[] {
  const extra = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ["https://framing-cam.netlify.app", "https://baobao1996121.github.io", ...extra];
}

/** True when the caller is still inside the quota. */
export function allowRate(ip: string, now: number, limit = 8, windowMs = 60_000, store = buckets): boolean {
  const key = ip || "unknown";
  const current = store.get(key);
  if (!current || now >= current.reset) {
    store.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-nf-client-connection-ip") || request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || "unknown";
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
