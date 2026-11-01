import { describe, expect, it } from "vitest";
import { installImportScriptsShim, prefersMainThread } from "../src/vision/loader";

describe("worker loader shim", () => {
  it("runs landmarkers on the main thread for iOS and desktop Safari", () => {
    expect(prefersMainThread("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 Version/18.5 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(prefersMainThread("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.5 Safari/605.1.15")).toBe(true);
    expect(prefersMainThread("Mozilla/5.0 (Linux) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")).toBe(false);
  });

  it("throws TypeError so MediaPipe uses import() instead of document", () => {
    const scope: { importScripts?: (url: string) => void } = {};
    installImportScriptsShim(scope);
    expect(typeof scope.importScripts).toBe("function");
    expect(() => scope.importScripts!("/vendor/wasm/vision_wasm_module_internal.js")).toThrow(TypeError);
  });

  it("leaves a real importScripts in place", () => {
    let called = false;
    const existing = () => {
      called = true;
    };
    const scope = { importScripts: existing };
    installImportScriptsShim(scope);
    scope.importScripts();
    expect(called).toBe(true);
  });
});
