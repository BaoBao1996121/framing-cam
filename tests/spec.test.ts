import { describe, expect, it } from "vitest";
import { measure } from "../src/guidance/machine";
import { SpecGuide } from "../src/guidance/spec-guide";
import { simulateSuite } from "../src/guidance/simulate";
import { eyesClosedFromBlend } from "../src/guidance/eyes";
import { predictRect } from "../src/guidance/predict";
import { subjectRegion } from "../src/composition/subject";
import { horizontalBand, idealBands, nagBands, portraitTargets } from "../src/composition/targets";
import { ASPECT_IDS, type AspectId } from "../src/composition/types";
import type { ShotSize } from "../src/composition/intent";
import { headTopFromCategoryMask, headTopFromFace } from "../src/composition/head-top";
import { frameCrop, resolveTarget } from "../src/composition/solve";
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
  it("keeps every ideal range inside the no-nag band", () => {
    const shots: ShotSize[] = ["close", "medium", "three-quarter", "full", "wide"];
    const aspects = ASPECT_IDS;
    const within = (ideal: [number, number] | null, band: [number, number] | null) => {
      if (!ideal || !band) return;
      expect(ideal[0]).toBeGreaterThanOrEqual(band[0] - 1e-9);
      expect(ideal[1]).toBeLessThanOrEqual(band[1] + 1e-9);
    };
    for (const shot of shots) {
      for (const aspect of aspects as AspectId[]) {
        const ideal = idealBands(shot, aspect);
        const band = nagBands(shot, aspect, ideal.eyeY, ideal.headroom, ideal.subjH);
        within(ideal.eyeY, band.eyeY);
        within(ideal.headroom, band.headroom);
        within(ideal.subjH, band.subjH);
        within(ideal.headH, band.headH);
        within(ideal.faceX, band.faceX);
      }
    }
  });

  it("accepts a 9:16 close-up that sits on the ghost", () => {
    const aspect = "9:16" as const;
    const frameSize = { width: 1080, height: 1920, aspect };
    const crop = frameCrop(frameSize);
    const ideal = resolveTarget({ shotSize: "close" }, aspect);
    const headH = ((ideal.headHRange![0] + ideal.headHRange![1]) / 2) * crop.h;
    const eyeY = crop.y + ideal.eyeY * crop.h;
    const headTop = crop.y + ideal.headroom * crop.h;
    const step = new SpecGuide().step({
      now: 0,
      subject: {
        id: "ghost",
        eye: { x: crop.x + crop.w * 0.5, y: eyeY },
        headTop,
        chinY: headTop + headH,
        headLeft: 0.4,
        headRight: 0.6,
        yaw: 0,
        shouldersY: null,
        shoulders: [],
        joints: [],
        confidence: 1,
      },
      shotSize: "close",
      frame: frameSize,
      rollDeg: 0,
      steady: true,
    });
    expect(step.hint).not.toBe("closer");
    expect(["ready", "hold"]).toContain(step.hint);
  });

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

  it("searches again after the subject has been gone for a short gap", () => {
    const guide = new SpecGuide();
    const seen = guide.step({ now: 0, subject: bust(), shotSize: "close", frame, rollDeg: 0, steady: true });
    expect(seen.hint).not.toBe("searching");
    const brief = guide.step({ now: 200, subject: null, shotSize: "close", frame, rollDeg: 0, steady: true });
    expect(brief.hint).toBe(seen.hint);
    expect(brief.complete).toBe(false);
    expect(brief.aligned).toBe(false);
    const gone = guide.step({ now: 700, subject: null, shotSize: "close", frame, rollDeg: 0, steady: true });
    expect(gone.hint).toBe("searching");
    expect(gone.complete).toBe(false);
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
  it("keeps flips under one a minute and reports hint and capture times apart from compute", () => {
    const report = simulateSuite();
    console.log(JSON.stringify(report));
    expect(report.guidedConvergence).toBeGreaterThanOrEqual(0.9);
    expect(report.flipsPerMin).toBeLessThanOrEqual(1);
    expect(report.timeToFirstHintMs).toBeGreaterThanOrEqual(0);
    expect(report.timeToCaptureMs).not.toBeNull();
    expect((report.timeToCaptureMs ?? 0) - (report.timeToReadyMs ?? 0)).toBe(1000);
    expect(report.computeP95Ms).toBeLessThan(150);
    expect(report.computeP95Ms).toBeLessThan(report.timeToCaptureMs ?? 1);
  });
});
