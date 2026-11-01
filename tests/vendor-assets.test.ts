import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const wasmDir = join(root, "public/vendor/wasm");
const modelDir = join(root, "public/vendor/models");

describe("same-origin vision assets", () => {
  it("vendors the wasm runtime, the name the loader requests, and both models", () => {
    for (const name of [
      "vision_wasm_module_internal.js",
      "vision_wasm_module_internal.wasm",
      "vision_wasm_module_raw_internal.wasm",
      "vision_wasm_nosimd_internal.wasm",
    ]) {
      expect(statSync(join(wasmDir, name)).size).toBeGreaterThan(1000);
    }
    expect(statSync(join(modelDir, "face_landmarker.task")).size).toBeGreaterThan(100_000);
    expect(statSync(join(modelDir, "pose_landmarker_lite.task")).size).toBeGreaterThan(100_000);
  });

  it("does not point the runtime at a public CDN", () => {
    const banned = /jsdelivr|storage\.googleapis|unpkg|esm\.sh/;
    for (const name of readdirSync(wasmDir)) {
      if (!name.endsWith(".js")) continue;
      expect(readFileSync(join(wasmDir, name), "utf8")).not.toMatch(banned);
    }
    const sources = ["src", "index.html", "netlify.toml"];
    for (const relative of sources) {
      const full = join(root, relative);
      const files = statSync(full).isDirectory()
        ? walk(full).filter((file) => /\.(ts|css|html)$/.test(file))
        : [full];
      for (const file of files) {
        expect(readFileSync(file, "utf8"), file).not.toMatch(banned);
      }
    }
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
