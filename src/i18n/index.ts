import type { Copy } from "./en";
import { en } from "./en";
import { zhCN } from "./zh-CN";

export type LocaleId = "zh-CN" | "en";

const DICTS: Record<LocaleId, Copy> = { "zh-CN": zhCN, en };

export function readLocale(): LocaleId {
  try {
    const saved = localStorage.getItem("framing-cam-locale");
    if (saved === "en" || saved === "zh-CN") return saved;
  } catch {
    /* private mode */
  }
  const fromUrl = new URLSearchParams(location.search).get("lang");
  if (fromUrl === "en" || fromUrl === "zh-CN") return fromUrl;
  return "zh-CN";
}

export function storeLocale(locale: LocaleId): void {
  try {
    localStorage.setItem("framing-cam-locale", locale);
  } catch {
    /* ignore */
  }
}

export function copyFor(locale: LocaleId): Copy {
  return DICTS[locale];
}
