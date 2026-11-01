import type { Subject } from "../composition/types";
import { LiveGuide } from "./live";

const frame = { width: 480, height: 640, aspect: "4:5" as const };

function person(cx: number, eyeY: number, headH: number): Subject {
  const headTop = eyeY - headH * 0.68;
  const chin = headTop + headH;
  return {
    id: "sim",
    eye: { x: cx, y: eyeY },
    headTop,
    chinY: chin,
    headLeft: cx - headH * 0.45,
    headRight: cx + headH * 0.45,
    yaw: 0,
    shouldersY: chin + headH * 0.15,
    shoulders: [
      { x: cx - headH * 0.55, y: chin + headH * 0.15 },
      { x: cx + headH * 0.55, y: chin + headH * 0.15 },
    ],
    joints: [],
    confidence: 1,
  };
}

function follow(cx: number, eyeY: number, headH: number, hint: string): { cx: number; eyeY: number; headH: number } {
  const step = 0.0016;
  if (hint === "left") return { cx: cx + step, eyeY, headH };
  if (hint === "right") return { cx: cx - step, eyeY, headH };
  if (hint === "up") return { cx, eyeY: eyeY + step, headH };
  if (hint === "down") return { cx, eyeY: eyeY - step, headH };
  if (hint === "closer") return { cx, eyeY, headH: headH + step };
  if (hint === "back") return { cx, eyeY, headH: headH - step };
  return { cx, eyeY, headH };
}

export type SimReport = {
  trials: number;
  converged: number;
  convergence: number;
  reversalRate: number;
  reversalsPerMin: number;
  progressionPerMin: number;
  computeP95Ms: number;
  instructionHoldMs: number;
};

/** Synthetic close-up on a 3:4 frame. The phone is simulated; this is not a device measurement. */
export function simulateApproaches(trials = 24): SimReport {
  let converged = 0;
  let reversals = 0;
  let changes = 0;
  let minutes = 0;
  const latencies: number[] = [];
  for (let trial = 0; trial < trials; trial += 1) {
    let cx = 0.22 + (trial % 5) * 0.12;
    let eyeY = 0.22 + (trial % 4) * 0.08;
    let headH = 0.22 + (trial % 3) * 0.05;
    const guide = new LiveGuide();
    guide.reset(0);
    let elapsed = 500 * 50;
    let ok = false;
    for (let frameIndex = 0; frameIndex < 500; frameIndex += 1) {
      const now = frameIndex * 50;
      const step = guide.update({
        now,
        subject: person(cx, eyeY, headH),
        shotSize: "close",
        frame,
        rollDeg: 0,
        steady: true,
      });
      latencies.push(step.computeMs);
      if (step.hint === "ready") {
        ok = true;
        elapsed = now;
        break;
      }
      const next = follow(cx, eyeY, headH, step.hint);
      cx = Math.min(0.86, Math.max(0.14, next.cx));
      eyeY = Math.min(0.7, Math.max(0.12, next.eyeY));
      headH = Math.min(0.62, Math.max(0.12, next.headH));
    }
    const summary = guide.metrics.summary(elapsed);
    if (ok) converged += 1;
    reversals += summary.reversals;
    changes += summary.changes;
    minutes += Math.max(elapsed, 50) / 60000;
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  return {
    trials,
    converged,
    convergence: trials ? converged / trials : 0,
    reversalRate: changes ? reversals / changes : 0,
    reversalsPerMin: minutes ? reversals / minutes : 0,
    progressionPerMin: minutes ? changes / minutes : 0,
    computeP95Ms: p95,
    instructionHoldMs: 400,
  };
}
