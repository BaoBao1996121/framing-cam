import { describe, expect, it } from "vitest";
import { detectSubjects, subjectFromFaceAndPose, subjectRegion, type RawFace } from "../src/composition/subject";
import { initialGuide, measure, stepGuide, type GuideMemory } from "../src/guidance/machine";
import { compositionScore, smoothScore } from "../src/guidance/quality";
import { laplacianVariance, pickSharpest } from "../src/guidance/sharpness";
import { planIsStale } from "../src/guidance/stale";
import type { Rect } from "../src/composition/types";

const target: Rect = { x: 0.28, y: 0.12, w: 0.44, h: 0.5 };

describe("guidance state machine", () => {
  it("asks for distance before fine position", () => {
    const subject: Rect = { x: 0.1, y: 0.2, w: 0.2, h: 0.16 };
    const reading = measure(subject, target);
    expect(reading.move).toBe("closer");
    const step = stepGuide(initialGuide(0), { now: 0, subject, target, rollDeg: 0, steady: false });
    expect(step.phase).toBe("distance");
    expect(step.hint).toBe("closer");
  });

  it("moves sideways before it moves up or down", () => {
    const subject: Rect = { x: 0.05, y: 0.42, w: 0.44, h: 0.5 };
    expect(measure(subject, target).move).toBe("left");
    const step = stepGuide(initialGuide(0), { now: 0, subject, target, rollDeg: 0, steady: true });
    expect(step.hint).toBe("left");
  });

  it("moves left when the subject is left of a same-size target", () => {
    const subject: Rect = { x: 0.02, y: 0.12, w: 0.44, h: 0.5 };
    expect(measure(subject, target).move).toBe("left");
    const step = stepGuide(initialGuide(0), { now: 0, subject, target, rollDeg: 0, steady: true });
    expect(step.phase).toBe("position");
    expect(step.hint).toBe("left");
  });

  it("uses hysteresis around the aligned band", () => {
    const subject: Rect = { x: 0.17, y: 0.12, w: 0.44, h: 0.5 };
    const error = measure(subject, target).error;
    expect(error).toBeGreaterThan(1);
    expect(error).toBeLessThan(1.5);
    const held: GuideMemory = { aligned: true, shown: "hold", pending: "hold", pendingSince: 0 };
    expect(stepGuide(held, { now: 100, subject, target, rollDeg: 0, steady: true }).aligned).toBe(true);
    const loose: GuideMemory = { aligned: false, shown: "left", pending: "left", pendingSince: 0 };
    expect(stepGuide(loose, { now: 100, subject, target, rollDeg: 0, steady: true }).aligned).toBe(false);
  });

  it("waits about 300ms before switching a movement hint", () => {
    const left: Rect = { x: 0.02, y: 0.12, w: 0.44, h: 0.5 };
    const right: Rect = { x: 0.5, y: 0.12, w: 0.44, h: 0.5 };
    let memory = stepGuide(initialGuide(0), { now: 0, subject: left, target, rollDeg: 0, steady: false }).memory;
    expect(memory.shown).toBe("left");
    memory = stepGuide(memory, { now: 200, subject: right, target, rollDeg: 0, steady: false }).memory;
    expect(memory.shown).toBe("left");
    memory = stepGuide(memory, { now: 520, subject: right, target, rollDeg: 0, steady: false }).memory;
    expect(memory.shown).toBe("right");
  });

  it("turns ready once the subject is on the target and the phone is steady", () => {
    const step = stepGuide(initialGuide(0), { now: 0, subject: target, target, rollDeg: 0, steady: true });
    expect(step.aligned).toBe(true);
    expect(step.phase).toBe("aligned");
    expect(step.hint).toBe("ready");
    expect(step.score).toBeGreaterThan(0.8);
  });

  it("levels the phone before nudging position", () => {
    const step = stepGuide(initialGuide(0), { now: 0, subject: target, target, rollDeg: 8, steady: true });
    expect(step.hint).toBe("raiseRight");
  });
});

describe("face-only close-ups", () => {
  it("counts a face with no body as a subject", () => {
    const face: RawFace = {
      forehead: { x: 0.5, y: 0.22 },
      chin: { x: 0.5, y: 0.48 },
      leftEye: { x: 0.42, y: 0.3 },
      rightEye: { x: 0.58, y: 0.3 },
      nose: { x: 0.5, y: 0.36 },
      leftCheek: { x: 0.36, y: 0.36 },
      rightCheek: { x: 0.64, y: 0.36 },
    };
    const subject = subjectFromFaceAndPose(face, null);
    expect(subject).not.toBeNull();
    expect(detectSubjects([face], [])).toHaveLength(1);
    const box = subjectRegion({ ...subject!, id: "face" });
    expect(box.h).toBeGreaterThan(0.2);
    expect(box.w).toBeGreaterThan(0.15);
  });
});

describe("stale plans, sharpness, and the offline score", () => {
  it("treats motion toward the target as progress", () => {
    const anchor: Rect = { x: 0.02, y: 0.12, w: 0.44, h: 0.5 };
    const closer: Rect = { x: 0.16, y: 0.12, w: 0.44, h: 0.5 };
    expect(planIsStale(anchor, closer, target, 0)).toBe(false);
    const away: Rect = { x: 0.7, y: 0.6, w: 0.2, h: 0.2 };
    expect(planIsStale(anchor, away, target, 0)).toBe(true);
    expect(planIsStale(anchor, null, target, 900)).toBe(true);
    expect(planIsStale(anchor, null, target, 200)).toBe(false);
  });

  it("scores a checkerboard sharper than a flat frame", () => {
    const size = 12;
    const sharp = new Uint8ClampedArray(size * size * 4);
    const flat = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const index = (y * size + x) * 4;
        const on = (x + y) % 2 === 0 ? 255 : 0;
        sharp[index] = sharp[index + 1] = sharp[index + 2] = on;
        flat[index] = flat[index + 1] = flat[index + 2] = 40;
      }
    }
    expect(laplacianVariance(sharp, size, size)).toBeGreaterThan(laplacianVariance(flat, size, size));
    expect(pickSharpest([{ score: 1 }, { score: 4 }, { score: 2 }])?.score).toBe(4);
  });

  it("smooths the offline composition score and warns on tilt and darkness", () => {
    const good = compositionScore({ subject: { x: 0.28, y: 0.12, w: 0.4, h: 0.34 }, luminance: 0.55, rollDeg: 0 });
    expect(good.score).toBeGreaterThan(0.6);
    expect(good.warnings).toEqual([]);
    const poor = compositionScore({ subject: { x: 0.02, y: 0.7, w: 0.2, h: 0.1 }, luminance: 0.1, rollDeg: 10 });
    expect(poor.warnings).toContain("tilt");
    expect(poor.warnings).toContain("dark");
    expect(smoothScore(0.2, 0.8)).toBeGreaterThan(0.2);
    expect(smoothScore(0.2, 0.8)).toBeLessThan(0.8);
  });
});
