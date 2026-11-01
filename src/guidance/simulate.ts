import { measureExtent } from "../composition/measure";
import { frameCrop } from "../composition/solve";
import type { ShotSize } from "../composition/intent";
import type { Subject } from "../composition/types";
import { LiveGuide } from "./live";

const frame = { width: 480, height: 640, aspect: "4:5" as const };
const crop = frameCrop(frame);

const SHOTS: ShotSize[] = ["close", "medium", "three-quarter", "full", "wide"];

/** Build a figure whose measured extent height is `extent` and whose eyes sit at `eyeY`. */
function figure(shot: ShotSize, cx: number, eyeY: number, extent: number): Subject {
  const headTop = shot === "close" ? eyeY - extent * 0.68 : eyeY - Math.min(extent * 0.2, eyeY - 0.02);
  const chin = shot === "close" ? headTop + extent : headTop + Math.max(0.04, extent * 0.22);
  const shoulder = headTop + extent * 0.55;
  const hip = headTop + extent * 1.15;
  const ankle = headTop + extent - 0.03;
  const joints: Subject["joints"] = [];
  if (shot === "medium" || shot === "three-quarter" || shot === "full" || shot === "wide") {
    joints.push({ name: "hip", x: cx - extent * 0.12, y: hip }, { name: "hip", x: cx + extent * 0.12, y: hip });
  }
  if (shot === "three-quarter") {
    const kneeY = hip + (headTop + extent - hip) / 0.625;
    joints.push({ name: "knee", x: cx - 0.08, y: kneeY }, { name: "knee", x: cx + 0.08, y: kneeY });
  }
  if (shot === "full" || shot === "wide") {
    joints.push({ name: "ankle", x: cx - 0.06, y: ankle }, { name: "ankle", x: cx + 0.06, y: ankle });
  }
  return {
    id: "sim",
    eye: { x: cx, y: eyeY },
    headTop,
    chinY: chin,
    headLeft: cx - 0.08,
    headRight: cx + 0.08,
    yaw: 0,
    shouldersY: shot === "close" ? null : shoulder,
    shoulders: shot === "close" ? [] : [
      { x: cx - 0.12, y: shoulder },
      { x: cx + 0.12, y: shoulder },
    ],
    joints,
    confidence: 1,
  };
}

function jitter(subject: Subject, amp: number, noise: () => number): Subject {
  const j = () => (noise() - 0.5) * 2 * amp;
  return {
    ...subject,
    eye: { x: subject.eye.x + j(), y: subject.eye.y + j() },
    headTop: subject.headTop + j(),
    chinY: subject.chinY + j(),
    headLeft: subject.headLeft + j(),
    headRight: subject.headRight + j(),
    shouldersY: subject.shouldersY == null ? null : subject.shouldersY + j(),
    shoulders: subject.shoulders.map((point) => ({ x: point.x + j(), y: point.y + j() })),
    joints: subject.joints.map((joint) => ({ ...joint, x: joint.x + j(), y: joint.y + j() })),
  };
}

type Behavior = "follow" | "overshoot" | "ignore" | "drift" | "hard-overshoot";
type Noise = "clean" | "jitter" | "drop";

function stepToward(cx: number, eyeY: number, extent: number, hint: string, amount: number): { cx: number; eyeY: number; extent: number } {
  if (hint === "left") return { cx: cx + amount, eyeY, extent };
  if (hint === "right") return { cx: cx - amount, eyeY, extent };
  if (hint === "up") return { cx, eyeY: eyeY + amount, extent };
  if (hint === "down") return { cx, eyeY: eyeY - amount, extent };
  if (hint === "closer") return { cx, eyeY, extent: extent + amount };
  if (hint === "back") return { cx, eyeY, extent: extent - amount };
  return { cx, eyeY, extent };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export type SimReport = {
  trials: number;
  guidedTrials: number;
  guidedConverged: number;
  guidedConvergence: number;
  flips: number;
  progressions: number;
  flipsPerMin: number;
  progressionPerMin: number;
  timeToFirstHintMs: number | null;
  timeToReadyMs: number | null;
  timeToCaptureMs: number | null;
  computeP95Ms: number;
  captureHoldMs: number;
};

/**
 * Synthetic phone. Not a device measurement.
 * Progressions (distance, then vertical, then horizontal) are counted apart from flips
 * (opposite directions, or a hint that comes back).
 */
export function simulateSuite(): SimReport {
  const behaviors: Behavior[] = ["follow", "overshoot", "ignore", "drift", "hard-overshoot"];
  const noises: Noise[] = ["clean", "jitter", "drop"];
  let guidedTrials = 0;
  let guidedConverged = 0;
  let flips = 0;
  let progressions = 0;
  let minutes = 0;
  const firstHints: number[] = [];
  const readies: number[] = [];
  const captures: number[] = [];
  const latencies: number[] = [];
  let trials = 0;
  for (const shot of SHOTS) {
    for (const behavior of behaviors) {
      for (const noise of noises) {
        trials += 1;
        const guided = behavior !== "ignore";
        if (guided) guidedTrials += 1;
        const amount = behavior === "hard-overshoot" ? 0.0048 : behavior === "overshoot" ? 0.003 : behavior === "drift" ? 0.0016 : 0.002;
        let cx = 0.28 + (trials % 3) * 0.04;
        let eyeY = shot === "full" || shot === "wide" ? 0.42 : 0.22;
        let extent = shot === "wide" ? 0.22 : shot === "close" ? 0.24 : 0.48;
        const guide = new LiveGuide();
        guide.reset(0);
        const limit = behavior === "hard-overshoot" ? 900 : 700;
        let elapsed = (limit - 1) * 40;
        let ready = false;
        for (let index = 0; index < limit; index += 1) {
          const now = index * 40;
          const dropped = noise === "drop" && index % 9 === 8;
          let subject: Subject | null = dropped ? null : figure(shot, cx, eyeY, extent);
          if (subject && noise === "jitter") subject = jitter(subject, 0.004, Math.random);
          if (behavior === "drift") cx += 0.00012;
          const step = guide.update({ now, subject, shotSize: shot, frame, rollDeg: 0, steady: index > 8 });
          latencies.push(step.computeMs);
          if (step.hint === "ready" && !ready) {
            ready = true;
            elapsed = now;
            if (behavior !== "hard-overshoot") break;
          }
          if (behavior === "ignore" || step.hint === "ready" || step.hint === "hold") continue;
          const next = stepToward(cx, eyeY, extent, step.hint, step.stage === "little" ? amount * 0.45 : amount);
          cx = Math.min(0.9, Math.max(0.1, next.cx));
          eyeY = Math.min(0.82, Math.max(0.08, next.eyeY));
          extent = Math.min(0.92, Math.max(0.12, next.extent));
        }
        const summary = guide.metrics.summary(elapsed);
        flips += summary.flips;
        progressions += summary.progressions;
        minutes += Math.max(elapsed, 40) / 60000;
        if (summary.timeToFirstHintMs != null) firstHints.push(summary.timeToFirstHintMs);
        if (guided && ready) {
          guidedConverged += 1;
          if (summary.timeToReadyMs != null) readies.push(summary.timeToReadyMs);
          if (summary.timeToCaptureMs != null) captures.push(summary.timeToCaptureMs);
        }
      }
    }
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  return {
    trials,
    guidedTrials,
    guidedConverged,
    guidedConvergence: guidedTrials ? guidedConverged / guidedTrials : 0,
    flips,
    progressions,
    flipsPerMin: minutes ? flips / minutes : 0,
    progressionPerMin: minutes ? progressions / minutes : 0,
    timeToFirstHintMs: median(firstHints),
    timeToReadyMs: median(readies),
    timeToCaptureMs: median(captures),
    computeP95Ms: p95,
    captureHoldMs: 1000,
  };
}

/** Kept so older calls still run the full suite. */
export function simulateApproaches(): SimReport {
  return simulateSuite();
}

export function extentMatches(shot: ShotSize, cx: number, eyeY: number, extent: number): number {
  return measureExtent(figure(shot, cx, eyeY, extent), shot).rect.h;
}

export { crop };
