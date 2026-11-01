import { describe, expect, it } from "vitest";
import { coverTransform, imageToScreen, largestAspectRect, pixelAspect, screenToImage, toNorm } from "../src/composition/geometry";
import { classifyShot } from "../src/composition/measure";
import { planFrame } from "../src/composition/plan";
import { frameCrop, resolveTarget } from "../src/composition/solve";
import type { Subject } from "../src/composition/types";
import { evaluateCrop, jointEdgePenalty, prepareLlmCrop, totalJointPenalty } from "../src/composition/rank";
import { AutoShutter, SteadyDetector } from "../src/composition/steady";
import { assignIds, detectSubjects, smoothSubject, type RawFace, type RawPose } from "../src/composition/subject";
import { stabilizeGuidance } from "../src/composition/plan";
import { ASPECTS, type AspectId } from "../src/composition/types";
import { applyGuidance, DEMO_HEIGHT, DEMO_START, DEMO_WIDTH, idealPortraitState, subjectFromDemo } from "../src/demo/person";
import { en } from "../src/i18n/en";
import { zhCN } from "../src/i18n/zh-CN";
import { chooseRoll, linearAccelerationG, rollFromGamma, rollFromGravity } from "../src/sensors/level";
import { crc32, zipStore } from "../src/export/zip";
import { coerceFraming, extractJson } from "../src/composition/llm";

const GUIDANCE = [
  "searching",
  "left",
  "right",
  "up",
  "down",
  "closer",
  "back",
  "raiseLeft",
  "raiseRight",
  "turnUpright",
  "steady",
  "ready",
] as const;

function readyFace(dx = 0, dy = 0, scale = 1): Subject {
  const sized = { width: DEMO_WIDTH, height: DEMO_HEIGHT, aspect: "4:5" as const };
  const crop = frameCrop(sized);
  const ideal = resolveTarget({ shotSize: "close" }, "4:5");
  const headH = ((ideal.headHRange![0] + ideal.headHRange![1]) / 2) * crop.h * scale;
  const eyeY = crop.y + ideal.eyeY * crop.h + dy;
  const headTop = crop.y + ideal.headroom * crop.h + dy;
  const x = crop.x + crop.w * 0.5 + dx;
  return {
    id: "face",
    eye: { x, y: eyeY },
    headTop,
    chinY: headTop + headH,
    headLeft: x - 0.06,
    headRight: x + 0.06,
    yaw: 0,
    shouldersY: null,
    shoulders: [],
    joints: [],
    confidence: 1,
  };
}

function planFace(subject: Subject, extra: Partial<Parameters<typeof planFrame>[0]> = {}) {
  return planFrame({
    imageWidth: DEMO_WIDTH,
    imageHeight: DEMO_HEIGHT,
    subjects: [subject],
    selectedId: null,
    aspect: "4:5",
    rollDeg: extra.rollDeg ?? 0,
    steady: extra.steady ?? true,
    shotSize: "close",
    ...extra,
  });
}

function planAt(state = idealPortraitState("4:5"), extra: Partial<Parameters<typeof planFrame>[0]> = {}) {
  return planFrame({
    imageWidth: DEMO_WIDTH,
    imageHeight: DEMO_HEIGHT,
    subjects: [subjectFromDemo(state)],
    selectedId: null,
    aspect: "4:5",
    rollDeg: state.roll,
    steady: true,
    ...extra,
  });
}

describe("portrait guidance", () => {
  it("treats an ideal chest-up placement as ready", () => {
    const plan = planFace(readyFace());
    expect(plan.ready).toBe(true);
    expect(plan.guidance).toBe("ready");
    expect(plan.quality === "good" || plan.quality === "ok").toBe(true);
    const ratio = pixelAspect(plan.crop, DEMO_WIDTH, DEMO_HEIGHT);
    expect(Math.abs(ratio - 4 / 5)).toBeLessThan(0.015);
    const subject = readyFace();
    const eyeRel = (subject.eye.y - plan.crop.y) / plan.crop.h;
    expect(Math.abs(eyeRel - resolveTarget({ shotSize: "close" }, "4:5").eyeY)).toBeLessThan(0.04);
    expect(plan.zoom).toBeLessThanOrEqual(1.7);
  });

  it("points the holder toward the subject", () => {
    expect(planFace(readyFace(-0.2)).guidance).toBe("left");
    expect(planFace(readyFace(0.2)).guidance).toBe("right");
    expect(planFace(readyFace(0, -0.12)).guidance).toBe("up");
    expect(planFace(readyFace(0, 0.12)).guidance).toBe("down");
    expect(planFace(readyFace(0, 0, 0.45)).guidance).toBe("closer");
    expect(planFace(readyFace(0, 0, 1.8)).guidance).toBe("back");
    expect(planFace(readyFace(), { rollDeg: 8 }).guidance).toBe("raiseRight");
    expect(planFace(readyFace(), { rollDeg: -8 }).guidance).toBe("raiseLeft");
    expect(planFace(readyFace(), { steady: false }).guidance).toBe("steady");
    expect(planAt(idealPortraitState("4:5"), { subjects: [] }).guidance).toBe("searching");
  });

  it("does not flip left and right for the mirrored selfie preview", () => {
    const rear = planFace(readyFace(-0.2));
    const selfie = planFace(readyFace(-0.2), { mirror: true });
    expect(rear.guidance).toBe("left");
    expect(selfie.guidance).toBe("left");
    expect(planFace(readyFace(), { rollDeg: 8, mirror: true }).guidance).toBe("raiseRight");
  });

  it("asks for closer before a small pan, because distance is what preserves detail", () => {
    const plan = planFace(readyFace(-0.12, 0, 0.45));
    expect(plan.guidance).toBe("closer");
    expect(plan.quality === "ok" || plan.quality === "low").toBe(true);
  });

  it("follows guidance until the simulated holder is ready to shoot", () => {
    let state = { ...DEMO_START };
    let plan = planAt(state, { steady: true });
    for (let step = 0; step < 500 && !plan.ready; step += 1) {
      state = applyGuidance(state, plan.guidance, 0.1);
      plan = planAt(state, { steady: true });
    }
    expect(plan.ready).toBe(true);
    const subject = subjectFromDemo(state);
    expect(subject.headTop).toBeGreaterThan(plan.crop.y - 0.02);
    expect(subject.chinY).toBeLessThan(plan.crop.y + plan.crop.h + 0.02);
    expect(totalJointPenalty(plan.crop, subject)).toBeLessThan(0.5);
    expect(plan.zoom).toBeLessThanOrEqual(1.7);
  });

  it("prefers a crop that clears the knees over one that ends on them", () => {
    const subject = subjectFromDemo(idealPortraitState("4:5"));
    const knee = subject.joints.find((joint) => joint.name === "knee");
    expect(knee).toBeTruthy();
    const viewfinder = toNorm(largestAspectRect(DEMO_WIDTH, DEMO_HEIGHT, 4 / 5), DEMO_WIDTH, DEMO_HEIGHT);
    const cutting: typeof viewfinder = {
      x: viewfinder.x,
      y: knee!.y - viewfinder.h * 0.72,
      w: viewfinder.w,
      h: viewfinder.h * 0.72,
    };
    // Force the bottom edge onto the knee while keeping a legal-looking box inside the frame.
    cutting.y = Math.max(0, knee!.y - cutting.h);
    const chosen = planAt();
    const bad = evaluateCrop(cutting, subject, DEMO_WIDTH, DEMO_HEIGHT, "4:5", viewfinder);
    const good = evaluateCrop(chosen.crop, subject, DEMO_WIDTH, DEMO_HEIGHT, "4:5", viewfinder);
    expect(jointEdgePenalty(cutting, knee!, 0.04)).toBeGreaterThan(0.4);
    expect(good.score).toBeGreaterThan(bad.score);
    expect(chosen.crop.y + chosen.crop.h).toBeLessThan(knee!.y - 0.01);
  });
});

describe("other aspect ratios", () => {
  for (const aspect of Object.keys(ASPECTS) as AspectId[]) {
    it(`keeps a ${aspect} crop on the eyes`, () => {
      const state = idealPortraitState(aspect);
      const plan = planFrame({
        imageWidth: DEMO_WIDTH,
        imageHeight: DEMO_HEIGHT,
        subjects: [subjectFromDemo(state)],
        selectedId: null,
        aspect,
        rollDeg: 0,
        steady: true,
      });
      expect(Math.abs(pixelAspect(plan.crop, DEMO_WIDTH, DEMO_HEIGHT) - ASPECTS[aspect])).toBeLessThan(0.015);
      const subject = subjectFromDemo(state);
      const eyeRel = (subject.eye.y - plan.crop.y) / plan.crop.h;
      const ideal = resolveTarget({ shotSize: classifyShot(subject), yaw: subject.yaw }, aspect);
      expect(Math.abs(eyeRel - ideal.eyeY)).toBeLessThan(0.2);
    });
  }
});

describe("landmarks, tracking, and steady shutter", () => {
  it("estimates the skull above the face mesh and keeps ids", () => {
    const face: RawFace = {
      forehead: { x: 0.5, y: 0.3 },
      chin: { x: 0.5, y: 0.42 },
      leftEye: { x: 0.46, y: 0.34 },
      rightEye: { x: 0.54, y: 0.34 },
      nose: { x: 0.52, y: 0.37 },
      leftCheek: { x: 0.44, y: 0.38 },
      rightCheek: { x: 0.56, y: 0.38 },
    };
    const pose: RawPose = {
      landmarks: Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 })),
    };
    pose.landmarks[0] = { x: 0.5, y: 0.36, visibility: 0.9 };
    pose.landmarks[11] = { x: 0.42, y: 0.5, visibility: 0.9 };
    pose.landmarks[12] = { x: 0.58, y: 0.5, visibility: 0.9 };
    pose.landmarks[25] = { x: 0.46, y: 0.78, visibility: 0.9 };
    pose.landmarks[26] = { x: 0.54, y: 0.78, visibility: 0.9 };
    const [subject] = detectSubjects([face], [pose]);
    expect(subject.headTop).toBeLessThan(face.forehead.y);
    expect(subject.yaw).toBeGreaterThan(0.1);
    expect(subject.joints.some((joint) => joint.name === "knee")).toBe(true);

    const sequence = { n: 0 };
    const first = assignIds([], [subject], sequence);
    const moved = { ...subject, eye: { x: subject.eye.x + 0.02, y: subject.eye.y } };
    const second = assignIds(first.tracks, [moved, { ...subject, eye: { x: 0.2, y: 0.2 } }], sequence);
    expect(second.subjects[0].id).toBe(first.subjects[0].id);
    expect(second.subjects[1].id).not.toBe(first.subjects[0].id);
    const smoothed = smoothSubject(first.subjects[0], { ...first.subjects[0], eye: { x: 0.52, y: 0.35 } });
    expect(smoothed.eye.x).toBeGreaterThan(0.5);
    expect(smoothed.eye.x).toBeLessThan(0.52);
  });

  it("becomes steady only after half a second of a still subject", () => {
    const steady = new SteadyDetector();
    for (let time = 0; time <= 400; time += 50) steady.pushLandmark(time, 0.5, 0.4);
    expect(steady.isSteady(400)).toBe(false);
    steady.pushLandmark(500, 0.5, 0.4);
    steady.pushLandmark(560, 0.5, 0.4);
    expect(steady.isSteady(560)).toBe(true);
    const shaky = new SteadyDetector();
    for (let time = 0; time <= 560; time += 50) {
      shaky.pushLandmark(time, 0.5 + ((time / 50) % 2) * 0.04, 0.4);
    }
    expect(shaky.isSteady(560)).toBe(false);
  });

  it("fires the auto shutter once when the frame is ready", () => {
    const shutter = new AutoShutter();
    expect(shutter.update(false)).toBe(false);
    expect(shutter.update(true)).toBe(true);
    expect(shutter.update(true)).toBe(false);
    expect(shutter.update(false)).toBe(false);
    expect(shutter.update(true)).toBe(true);
  });

  it("holds a prompt until it repeats, but switches immediately to ready", () => {
    let memory = stabilizeGuidance(null, "left").memory;
    let step = stabilizeGuidance(memory, "right");
    expect(step.code).toBe("left");
    step = stabilizeGuidance(step.memory, "right");
    expect(step.code).toBe("left");
    step = stabilizeGuidance(step.memory, "right");
    expect(step.code).toBe("right");
    memory = step.memory;
    expect(stabilizeGuidance(memory, "ready").code).toBe("ready");
  });
});

describe("level, cover mapping, cloud box, and zip", () => {
  it("reads right-side-down as positive roll", () => {
    expect(rollFromGravity(0, -9.8, 0)).toBeCloseTo(0, 1);
    expect(rollFromGravity(2, -9.8, 0.2)!).toBeGreaterThan(5);
    expect(rollFromGravity(0, 0, 9.8)).toBeNull();
    expect(rollFromGamma(7, 80)).toBeCloseTo(7, 3);
    expect(chooseRoll({ gravity: { x: 0, y: -1, z: 0 }, gamma: 20, beta: 80 })).toBeCloseTo(0, 1);
    expect(linearAccelerationG({ x: 0.2, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })).toBeCloseTo(0.2, 2);
  });

  it("maps landmarks through object-fit cover, including the mirrored preview", () => {
    const cover = coverTransform(1920, 1080, 390, 844);
    expect(cover.drawH).toBeCloseTo(844, 4);
    expect(cover.offsetX).toBeLessThan(0);
    const center = imageToScreen(0.5, 0.5, cover, false);
    expect(center.x).toBeCloseTo(195, 3);
    const mirrored = imageToScreen(0.25, 0.5, cover, true);
    const back = screenToImage(mirrored.x, mirrored.y, cover, true);
    expect(back.x).toBeCloseTo(0.25, 4);
    expect(back.y).toBeCloseTo(0.5, 4);
  });

  it("rejects a cloud box that cuts off the head and snaps a valid one to 4:5", () => {
    const subject = subjectFromDemo(idealPortraitState("4:5"));
    const rejected = prepareLlmCrop({ x: 0.7, y: 0.7, w: 0.2, h: 0.25 }, subject, DEMO_WIDTH, DEMO_HEIGHT, "4:5");
    expect(rejected).toBeNull();
    const accepted = prepareLlmCrop(
      { x: 0.1, y: 0.12, w: 0.8, h: 0.7 },
      subject,
      DEMO_WIDTH,
      DEMO_HEIGHT,
      "4:5",
    );
    expect(accepted).not.toBeNull();
    expect(Math.abs(pixelAspect(accepted!, DEMO_WIDTH, DEMO_HEIGHT) - 0.8)).toBeLessThan(0.02);
    const plan = planAt(idealPortraitState("4:5"), {
      llm: { box: accepted!, confidence: 0.8, reasoning: "收紧到半身。" },
    });
    expect(plan.source).toBe("rules");
    expect(plan.llmReasoning).toContain("半身");
  });

  it("parses fenced model JSON and packs a zip the browser can download", () => {
    const parsed = coerceFraming(extractJson('```json\n{"box":{"x":0.1,"y":0.1,"w":0.8,"h":1},"primaryMove":"hold","reasoning":"Good.","confidence":2}\n```'));
    expect(parsed?.confidence).toBe(1);
    expect(parsed?.primaryMove).toBe("hold");
    expect(coerceFraming({ box: { x: 0, y: 0, w: 0, h: 1 } })).toBeNull();
    const zipped = zipStore([{ name: "framing-cam-4x5.jpg", data: new Uint8Array([1, 2, 3, 4]) }]);
    expect(zipped[0]).toBe(0x50);
    expect(zipped[1]).toBe(0x4b);
    expect(new TextDecoder().decode(zipped)).toContain("framing-cam-4x5.jpg");
    expect(crc32(new Uint8Array([1, 2, 3, 4]))).toBeGreaterThan(0);
  });
});

describe("copy", () => {
  it("has every prompt in Chinese and English", () => {
    for (const code of GUIDANCE) {
      expect(zhCN.guidance[code].length).toBeGreaterThan(1);
      expect(en.guidance[code].length).toBeGreaterThan(1);
    }
    for (const kind of ["head", "chest", "waist", "thigh", "full", "viewfinder"] as const) {
      expect(zhCN.framing[kind].length).toBeGreaterThan(1);
      expect(en.framing[kind].length).toBeGreaterThan(1);
    }
  });
});
