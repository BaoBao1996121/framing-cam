import { normalizeShotSize, type ShotSize } from "../composition/intent";
import type { FrameSize } from "../composition/solve";
import type { Subject } from "../composition/types";
import { SessionMetrics } from "./metrics";
import { predictRect } from "./predict";
import { SpecGuide, type SpecStep } from "./spec-guide";

export type LiveStep = SpecStep & { computeMs: number };

/** Filtered landmarks, one instruction, local counters. Nothing here is uploaded. */
export class LiveGuide {
  private spec = new SpecGuide();
  private seenAt = 0;
  private gammaPerSec = 0;
  readonly metrics = new SessionMetrics();
  eyesClosed = false;

  reset(now: number): void {
    this.spec.reset(now);
    this.metrics.reset(now);
  }

  noteDetection(now: number, gammaPerSec: number, eyesClosed: boolean): void {
    this.seenAt = now;
    this.gammaPerSec = Number.isFinite(gammaPerSec) ? gammaPerSec : 0;
    this.eyesClosed = eyesClosed;
  }

  update(input: {
    now: number;
    subject: Subject | null;
    shotSize: string;
    frame: FrameSize;
    rollDeg: number | null;
    steady: boolean;
    eyeLine?: number;
    headroom?: number;
    horizontal?: number;
  }): LiveStep {
    const shotSize: ShotSize = normalizeShotSize(input.shotSize);
    let subject = input.subject;
    if (subject) {
      const shifted = predictRect({ x: subject.eye.x, y: subject.eye.y, w: 0.2, h: 0.2 }, this.gammaPerSec, input.now - this.seenAt);
      const dx = shifted.x - subject.eye.x;
      if (dx !== 0) subject = { ...subject, eye: { x: subject.eye.x + dx, y: subject.eye.y } };
    }
    const started = performance.now();
    const step = this.spec.step({ ...input, subject, shotSize, yaw: subject?.yaw });
    const computeMs = performance.now() - started;
    this.metrics.record(input.now, step.hint, computeMs);
    return { ...step, computeMs };
  }
}
