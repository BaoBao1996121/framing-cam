import type { ShotPlan } from "../plans/types";

/** Pages builds leave this unset so they never request a missing /api. Netlify sets VITE_CLOUD=1. */
export function shouldProbeCloud(isDev: boolean, cloudFlag: string | undefined): boolean {
  return isDev || cloudFlag === "1";
}

function apiUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(path.replace(/^\//, ""), new URL(base, "http://local")).pathname;
}

export async function cloudAvailable(): Promise<boolean> {
  // Written inline so a Pages build (no VITE_CLOUD) drops the fetch entirely.
  if (!(import.meta.env.DEV || import.meta.env.VITE_CLOUD === "1")) return false;
  try {
    const response = await fetch(apiUrl("api/health"));
    if (!response.ok) return false;
    const body = (await response.json()) as { llm?: boolean };
    return Boolean(body.llm);
  } catch {
    return false;
  }
}

export async function requestShotPlans(input: {
  imageDataUrl: string;
  aspect: string;
  imageWidth: number;
  imageHeight: number;
  locale: string;
  style: string;
  rollDeg: number | null;
  zoom: { min: number; max: number; current: number };
  subject: Record<string, unknown> | null;
}): Promise<ShotPlan[] | null> {
  if (!(import.meta.env.DEV || import.meta.env.VITE_CLOUD === "1")) return null;
  try {
    const response = await fetch(apiUrl("api/frame"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean; plans?: ShotPlan[] };
    if (!body.ok || !body.plans || body.plans.length < 2) return null;
    return body.plans.slice(0, 4);
  } catch {
    return null;
  }
}
