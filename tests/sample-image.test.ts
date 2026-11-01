import { writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { pixelAspect } from "../src/composition/geometry";
import { planFrame } from "../src/composition/plan";
import type { Subject } from "../src/composition/types";

const WIDTH = 800;
const HEIGHT = 1000;

type RGB = [number, number, number];

const HEAD: RGB = [210, 60, 55];
const EYE: RGB = [30, 160, 70];
const SHOULDER: RGB = [170, 60, 180];
const ELBOW: RGB = [230, 150, 30];
const HIP: RGB = [40, 170, 170];
const KNEE: RGB = [40, 80, 210];
const ANKLE: RGB = [250, 230, 40];

function paintSample(): PNG {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const index = (WIDTH * y + x) << 2;
      const wall = y < 760;
      png.data[index] = wall ? 232 : 196;
      png.data[index + 1] = wall ? 220 : 176;
      png.data[index + 2] = wall ? 200 : 150;
      png.data[index + 3] = 255;
    }
  }
  const dot = (x: number, y: number, radius: number, color: RGB) => {
    for (let py = Math.floor(y - radius); py <= y + radius; py += 1) {
      for (let px = Math.floor(x - radius); px <= x + radius; px += 1) {
        if (px < 0 || py < 0 || px >= WIDTH || py >= HEIGHT) continue;
        if ((px - x) ** 2 + (py - y) ** 2 > radius ** 2) continue;
        const index = (WIDTH * py + px) << 2;
        png.data[index] = color[0];
        png.data[index + 1] = color[1];
        png.data[index + 2] = color[2];
      }
    }
  };
  dot(330, 305, 125, HEAD);
  dot(300, 280, 10, EYE);
  dot(360, 280, 10, EYE);
  dot(230, 500, 16, SHOULDER);
  dot(430, 500, 16, SHOULDER);
  dot(190, 640, 14, ELBOW);
  dot(470, 640, 14, ELBOW);
  dot(270, 760, 14, HIP);
  dot(390, 760, 14, HIP);
  dot(280, 930, 12, KNEE);
  dot(390, 930, 12, KNEE);
  dot(290, 990, 10, ANKLE);
  dot(380, 990, 10, ANKLE);
  return png;
}

function near(png: PNG, color: RGB, slack = 28): { x: number; y: number }[] {
  const hits: { x: number; y: number }[] = [];
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      if (
        Math.abs(png.data[index] - color[0]) <= slack &&
        Math.abs(png.data[index + 1] - color[1]) <= slack &&
        Math.abs(png.data[index + 2] - color[2]) <= slack
      ) {
        hits.push({ x, y });
      }
    }
  }
  return hits;
}

function centerOf(points: { x: number; y: number }[], side: "left" | "right" | "all"): { x: number; y: number } {
  const pool = side === "all" ? points : points.filter((point) => (side === "left" ? point.x < WIDTH / 2 : point.x >= WIDTH / 2));
  const used = pool.length ? pool : points;
  return {
    x: used.reduce((sum, point) => sum + point.x, 0) / used.length,
    y: used.reduce((sum, point) => sum + point.y, 0) / used.length,
  };
}

function subjectFromImage(png: PNG): Subject {
  const head = near(png, HEAD, 18);
  const eyes = near(png, EYE, 20);
  const shoulders = near(png, SHOULDER, 20);
  const elbows = near(png, ELBOW, 18);
  const hips = near(png, HIP, 18);
  const knees = near(png, KNEE, 18);
  const ankles = near(png, ANKLE, 18);
  expect(head.length).toBeGreaterThan(100);
  expect(eyes.length).toBeGreaterThan(20);
  const eye = centerOf(eyes, "all");
  const leftShoulder = centerOf(shoulders, "left");
  const rightShoulder = centerOf(shoulders, "right");
  const pair = (name: Subject["joints"][number]["name"], points: { x: number; y: number }[]) => {
    const left = centerOf(points, "left");
    const right = centerOf(points, "right");
    return [
      { name, x: left.x / WIDTH, y: left.y / HEIGHT },
      { name, x: right.x / WIDTH, y: right.y / HEIGHT },
    ];
  };
  const minX = Math.min(...head.map((point) => point.x));
  const maxX = Math.max(...head.map((point) => point.x));
  const minY = Math.min(...head.map((point) => point.y));
  const maxY = Math.max(...head.map((point) => point.y));
  return {
    id: "sample",
    eye: { x: eye.x / WIDTH, y: eye.y / HEIGHT },
    headTop: minY / HEIGHT,
    chinY: maxY / HEIGHT,
    headLeft: minX / WIDTH,
    headRight: maxX / WIDTH,
    yaw: 0,
    shouldersY: ((leftShoulder.y + rightShoulder.y) / 2) / HEIGHT,
    shoulders: [
      { x: leftShoulder.x / WIDTH, y: leftShoulder.y / HEIGHT },
      { x: rightShoulder.x / WIDTH, y: rightShoulder.y / HEIGHT },
    ],
    joints: [
      ...pair("elbow", elbows),
      ...pair("hip", hips),
      ...pair("knee", knees),
      ...pair("ankle", ankles),
    ],
    confidence: 1,
  };
}

describe("sample portrait image", () => {
  it("crops the painted person inside a 4:5 frame without slicing the knees", () => {
    const png = paintSample();
    writeFileSync(new URL("./fixtures/portrait-sample.png", import.meta.url), PNG.sync.write(png));
    const loaded = PNG.sync.read(PNG.sync.write(png));
    expect(loaded.width).toBe(WIDTH);
    const subject = subjectFromImage(loaded);
    const plan = planFrame({
      imageWidth: WIDTH,
      imageHeight: HEIGHT,
      subjects: [subject],
      selectedId: null,
      aspect: "4:5",
      rollDeg: 0,
      steady: false,
    });
    expect(plan.guidance).not.toBe("searching");
    expect(Math.abs(pixelAspect(plan.crop, WIDTH, HEIGHT) - 0.8)).toBeLessThan(0.02);

    const headPixels = near(loaded, HEAD, 18);
    for (const pixel of headPixels) {
      const x = pixel.x / WIDTH;
      const y = pixel.y / HEIGHT;
      expect(x).toBeGreaterThanOrEqual(plan.crop.x - 0.015);
      expect(x).toBeLessThanOrEqual(plan.crop.x + plan.crop.w + 0.015);
      expect(y).toBeGreaterThanOrEqual(plan.crop.y - 0.015);
      expect(y).toBeLessThanOrEqual(plan.crop.y + plan.crop.h + 0.015);
    }
    const eyeRel = (subject.eye.y - plan.crop.y) / plan.crop.h;
    expect(eyeRel).toBeGreaterThan(0.08);
    expect(eyeRel).toBeLessThan(0.55);
    const knee = subject.joints.find((joint) => joint.name === "knee");
    if (knee) expect(knee.y).toBeGreaterThan(plan.crop.y);
  });
});
