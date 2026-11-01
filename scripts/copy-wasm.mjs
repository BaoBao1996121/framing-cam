import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const dst = join(root, "public/vendor/wasm");
const files = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
];

mkdirSync(dst, { recursive: true });
for (const name of files) {
  copyFileSync(join(src, name), join(dst, name));
}
// The module loader asks for this name when locateFile is not installed yet.
copyFileSync(join(dst, "vision_wasm_module_internal.wasm"), join(dst, "vision_wasm_module_raw_internal.wasm"));
for (const name of files) {
  if (!name.endsWith(".js")) continue;
  const text = readFileSync(join(dst, name), "utf8");
  if (/jsdelivr|storage\.googleapis|unpkg/.test(text)) {
    throw new Error(`${name} references an external CDN`);
  }
}
console.log("copied MediaPipe wasm into public/vendor/wasm");
