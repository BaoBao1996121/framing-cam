import { describe, expect, it } from "vitest";
import { measure } from "../src/guidance/machine";
import { SpecGuide } from "../src/guidance/spec-guide";
import { simulateApproaches } from "../src/guidance/simulate";
import { eyesClosedFromBlend } from "../src/guidance/eyes";
import { predictRect } from "../src/guidance/predict";
import { subjectRegion } from "../src/composition/subject";
import { horizontalBand, portraitTargets } from "../src/composition/targets";
import { headTopFromCategoryMask, headTopFromFace } from "../src/composition/head-top";
import { resolveTarget } from "../src/composition/solve";
import type { Subject } from "../src/composition/types";

const frame = { width: 480, height: 640, aspect: "4:5" as const };

function bust(): Subject {
  return {
    id: "bust",
    eye: { x: 0.5, y: 0.32 },
    headTop: 0.18,
    chinY: 0.42,
    headLeft: 0.4,
    headRight: 0.6,
    yaw: 0,
    shouldersY: 0.5,
    shoulders: [
      { x: 0.36, y: 0.5 },
      { x: 0.64, y: 0.5 },
    ],
    joints: [],
    confidence: 1,
  };
}

describe("portrait spec", () => {
  it("aims at the spec ideal and stays quiet inside the calibrated band", () => {
    const guide = new SpecGuide();
    const inside = guide.step({
      now: 0,
      subject: { ...bust(), eye: { x: 0.5, y: 0.3 }, headTop: 0.16, chinY: 0.42 },
      shotSize: "close",
      frame,
      rollDeg: 0,
      steady: false,
    });
    expect(inside.hint === "up" || inside.hint === "down" || inside.hint === "closer" || inside.hint === "back").toBe(true);
    const quiet = new SpecGuide();
    const step = quiet.step({
      now: 0,
      subject: { ...bust(), eye: { x: 0.5, y: 0.36 }, headTop: 0.1, chinY: 0.48 },
      shotSize: "close",
      frame,
      rollDeg: 0,
      steady: true,
    });
    expect(["ready", "hold", "left", "right"]).toContain(step.hint);
    expect(horizontalBand(0.4, "medium")[0]).toBeCloseTo(0.45);
    expect(headTopFromFace(0.3, 0.5, portraitTargets.landmarks.headTopFromFace.faceTopMinusChinToFaceTopRatio)).toBeCloseTo(0.3 - 0.47 * 0.2);
    const mask = new Uint8Array(4 * 4);
    mask[2 * 4 + 1] = 1;
    expect(headTopFromCategoryMask(mask, 4, 4, 0.2, 0.5)).toBeCloseTo(0.5);
  });

  it("keeps proposed eye-line ranges configurable", () => {
    const base = resolveTarget({ shotSize: "close" }, "4:5");
    expect(base.eyeY).toBeCloseTo(0.355);
    const edited = structuredClone(portraitTargets);
    edited.shots.closeUp.ratios["4:5"].eyeY = [0.2, 0.22];
    expect(resolveTarget({ shotSize: "close" }, "4:5", edited).eyeY).toBeCloseTo(0.21);
    expect(resolveTarget({ shotSize: "close" }, "4:5").eyeY).toBeCloseTo(0.355);
  });

  it("does not tell a full-body plan to step closer when the feet are missing", () => {
    const subject = bust();
    const oldTarget = { x: 0.28, y: 0.06, w: 0.44, h: 0.82 };
    expect(measure(subjectRegion(subject), oldTarget).move).toBe("closer");
    const step = new SpecGuide().step({
      now: 0,
      subject,
      shotSize: "full",
      frame,
      rollDeg: 0,
      steady: true,
    });
    expect(step.complete).toBe(false);
    expect(step.hint).toBe("back");
  });

  it("treats closed eyes as closed and a missing blendshape list as open", () => {
    expect(eyesClosedFromBlend(undefined)).toBe(false);
    expect(
      eyesClosedFromBlend([
        { categoryName: "eyeBlinkLeft", score: 0.8 },
        { categoryName: "eyeBlinkRight", score: 0.7 },
      ]),
    ).toBe(true);
    expect(
      eyesClosedFromBlend([
        { categoryName: "eyeBlinkLeft", score: 0.2 },
        { categoryName: "eyeBlinkRight", score: 0.9 },
      ]),
    ).toBe(false);
  });

  it("clamps orientation prediction", () => {
    const next = predictRect({ x: 0.4, y: 0.2, w: 0.2, h: 0.3 }, 400, 500);
    expect(next.x - 0.4).toBeLessThanOrEqual(0.0201);
    expect(next.x).toBeGreaterThanOrEqual(0.4);
  });
});

describe("closed-loop simulator", () => {
  it("reports simulated convergence, reversals, and compute latency", () => {
    const report = simulateApproaches(24);
    console.log(JSON.stringify(report));
    expect(report.convergence).toBeGreaterThanOrEqual(0.95);
    expect(report.reversalRate).toBeLessThanOrEqual(0.02);
    expect(report.reversalsPerMin).toBeLessThanOrEqual(1);
    expect(report.computeP95Ms).toBeLessThanOrEqual(150);
  });
});
