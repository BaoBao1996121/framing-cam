import { measureExtent } from "../composition/measure";
import { frameCrop, placementFor, resolveTarget, type FrameSize } from "../composition/solve";
import { nagBands, portraitTargets, type PortraitTargets, type Range } from "../composition/targets";
import type { ShotSize } from "../composition/intent";
import type { Rect, Subject } from "../composition/types";
import type { GuideHint, GuidePhase } from "./machine";
import { OneEuro } from "./one-euro";

const OPPOSITE: Partial<Record<GuideHint, GuideHint>> = {
  left: "right",
  right: "left",
  up: "down",
  down: "up",
  closer: "back",
  back: "closer",
};

export type SpecMemory = {
  shown: GuideHint;
  pending: GuideHint;
  pendingSince: number;
  shownSince: number;
  bestError: number;
  errorAtShow: number;
  sizeOk: boolean;
  eyeOk: boolean;
  headOk: boolean;
  xOk: boolean;
  jointSince: number | null;
  readySince: number | null;
  stuck: boolean;
};

export type SpecStep = {
  hint: GuideHint;
  phase: GuidePhase;
  error: number;
  score: number;
  aligned: boolean;
  magnitude: number;
  /** How far to move. The direction hint stays put while this changes. */
  stage: "little" | "lot" | "none";
  stuck: boolean;
  rect: Rect | null;
  targetBox: Rect | null;
  complete: boolean;
  memory: SpecMemory;
};

type Sample = {
  eyeY: number;
  headroom: number;
  centerX: number;
  headH: number;
  subjH: number;
};

class MetricFilter {
  private eye: OneEuro;
  private head: OneEuro;
  private x: OneEuro;
  private headH: OneEuro;
  private subj: OneEuro;
  private ema: Sample | null = null;
  private readonly mode: string;
  private readonly alpha: number;

  constructor(config: PortraitTargets) {
    const smoothing = config.hysteresis.smoothing;
    this.mode = smoothing.type;
    this.alpha = smoothing.alpha;
    const minCutoff = "minCutoff" in smoothing ? Number(smoothing.minCutoff) : 1.2;
    const beta = "beta" in smoothing ? Number(smoothing.beta) : 0.02;
    this.eye = new OneEuro(minCutoff, beta);
    this.head = new OneEuro(minCutoff, beta);
    this.x = new OneEuro(minCutoff, beta);
    this.headH = new OneEuro(Math.min(1, minCutoff), beta * 0.5);
    this.subj = new OneEuro(Math.min(1, minCutoff), beta * 0.5);
  }

  filter(sample: Sample, now: number): Sample {
    if (this.mode === "ema") {
      if (!this.ema) {
        this.ema = sample;
        return sample;
      }
      const mix = (from: number, to: number) => from + (to - from) * this.alpha;
      this.ema = {
        eyeY: mix(this.ema.eyeY, sample.eyeY),
        headroom: mix(this.ema.headroom, sample.headroom),
        centerX: mix(this.ema.centerX, sample.centerX),
        headH: mix(this.ema.headH, sample.headH),
        subjH: mix(this.ema.subjH, sample.subjH),
      };
      return this.ema;
    }
    return {
      eyeY: this.eye.filter(sample.eyeY, now),
      headroom: this.head.filter(sample.headroom, now),
      centerX: this.x.filter(sample.centerX, now),
      headH: this.headH.filter(sample.headH, now),
      subjH: this.subj.filter(sample.subjH, now),
    };
  }
}

function excess(value: number, band: Range): number {
  const span = Math.max(0.02, band[1] - band[0]);
  if (value < band[0]) return (band[0] - value) / span;
  if (value > band[1]) return (value - band[1]) / span;
  return 0;
}

function sideOf(value: number, band: Range, wasOk: boolean, enter: number, exit: number): { ok: boolean; side: "low" | "high" | "ok" } {
  const [lo, hi] = band;
  if (wasOk) {
    if (value < lo - enter) return { ok: false, side: "low" };
    if (value > hi + enter) return { ok: false, side: "high" };
    return { ok: true, side: "ok" };
  }
  if (value >= lo + exit && value <= hi - exit) return { ok: true, side: "ok" };
  if (value < lo - enter) return { ok: false, side: "low" };
  if (value > hi + enter) return { ok: false, side: "high" };
  return { ok: false, side: "ok" };
}

export function initialSpec(now = 0): SpecMemory {
  return {
    shown: "searching",
    pending: "searching",
    pendingSince: now,
    shownSince: now,
    bestError: 2,
    errorAtShow: 2,
    sizeOk: false,
    eyeOk: false,
    headOk: false,
    xOk: false,
    jointSince: null,
    readySince: null,
    stuck: false,
  };
}

function project(subject: Subject, crop: Rect): Sample & { complete: boolean; rect: Rect } {
  const head = Math.max(0.001, subject.chinY - subject.headTop);
  return {
    eyeY: (subject.eye.y - crop.y) / crop.h,
    headroom: (subject.headTop - crop.y) / crop.h,
    centerX: (subject.eye.x - crop.x) / crop.w,
    headH: head / crop.h,
    subjH: 0,
    complete: true,
    rect: { x: 0, y: 0, w: 0, h: 0 },
  };
}

export class SpecGuide {
  private memory: SpecMemory = initialSpec();
  private filter = new MetricFilter(portraitTargets);
  private shot: ShotSize = "medium";
  private subjectId = "";
  private lastStage: "little" | "lot" | "none" = "none";
  private reversedAt = -10_000;
  private missingSince: number | null = null;

  constructor(private config: PortraitTargets = portraitTargets) {
    this.filter = new MetricFilter(config);
  }

  reset(now: number): void {
    this.memory = initialSpec(now);
    this.filter = new MetricFilter(this.config);
    this.subjectId = "";
    this.missingSince = null;
  }

  step(input: {
    now: number;
    subject: Subject | null;
    shotSize: ShotSize;
    frame: FrameSize;
    rollDeg: number | null;
    steady: boolean;
    yaw?: number;
    eyeLine?: number;
    headroom?: number;
    horizontal?: number;
  }): SpecStep {
    if (input.shotSize !== this.shot || (input.subject && input.subject.id !== this.subjectId)) {
      this.filter = new MetricFilter(this.config);
      this.shot = input.shotSize;
      this.subjectId = input.subject?.id ?? "";
    }
    if (!input.subject) {
      if (this.missingSince == null) this.missingSince = input.now;
      const gap = input.now - this.missingSince;
      if (this.memory.shown !== "searching" && gap < 400) {
        return {
          hint: this.memory.shown,
          phase: "search",
          error: this.memory.bestError,
          score: 0.4,
          aligned: false,
          magnitude: this.memory.bestError,
          stage: this.lastStage,
          stuck: false,
          rect: null,
          targetBox: null,
          complete: false,
          memory: this.memory,
        };
      }
      const memory = { ...this.memory, shown: "searching" as const, pending: "searching" as const, pendingSince: input.now };
      this.memory = memory;
      this.lastStage = "none";
      return { hint: "searching", phase: "search", error: 2, score: 0, aligned: false, magnitude: 2, stage: "none", stuck: false, rect: null, targetBox: null, complete: false, memory };
    }
    this.missingSince = null;
    if (input.frame.width < 2 || input.frame.height < 2) {
      const memory = { ...this.memory, shown: "searching" as const, pending: "searching" as const, pendingSince: input.now };
      this.memory = memory;
      this.lastStage = "none";
      return { hint: "searching", phase: "search", error: 2, score: 0, aligned: false, magnitude: 2, stage: "none", stuck: false, rect: null, targetBox: null, complete: false, memory };
    }
    const target = resolveTarget(
      { shotSize: input.shotSize, yaw: input.yaw ?? input.subject.yaw, eyeLine: input.eyeLine, headroom: input.headroom, horizontal: input.horizontal },
      input.frame.aspect,
      this.config,
    );
    const crop = frameCrop(input.frame);
    const extent = measureExtent(input.subject, input.shotSize, this.config);
    const raw = project(input.subject, crop);
    raw.subjH = extent.rect.h / crop.h;
    raw.rect = extent.rect;
    const sample = this.filter.filter(raw, input.now);
    const hysteresis = this.config.hysteresis;
    const bands = nagBands(input.shotSize, input.frame.aspect, target.eyeYRange, target.headroomRange, target.subjHRange);
    const faceOnly = extent.kind === "face";
    const sizeBand = faceOnly ? bands.headH : bands.subjH;
    const sizeValue = faceOnly ? sample.headH : sample.subjH;
    const size = sizeBand
      ? sideOf(sizeValue, sizeBand, this.memory.sizeOk, hysteresis.eyeY.enter, hysteresis.eyeY.exit)
      : { ok: true, side: "ok" as const };
    const eye = sideOf(sample.eyeY, bands.eyeY, this.memory.eyeOk, hysteresis.eyeY.enter, hysteresis.eyeY.exit);
    const head = bands.headroom
      ? sideOf(sample.headroom, bands.headroom, this.memory.headOk, hysteresis.headroom.enter, hysteresis.headroom.exit)
      : { ok: true, side: "ok" as const };
    const horizontal = sideOf(sample.centerX, bands.faceX, this.memory.xOk, hysteresis.centerX.enter, hysteresis.centerX.exit);
    const joint = this.jointHint(input.subject, crop, input.now);
    let desired: GuideHint = "hold";
    let phase: GuidePhase = "aligned";
    const headExcess = bands.headroom ? excess(sample.headroom, bands.headroom) : 0;
    const eyeExcess = excess(sample.eyeY, bands.eyeY);
    const verticalSide =
      head.side !== "ok" && (eye.side === "ok" || headExcess >= eyeExcess)
        ? head.side
        : eye.side;
    const chestHint = this.chestHint(input.subject, crop, extent.kind);
    if (!extent.complete) {
      desired = "back";
      phase = "distance";
    } else if (size.side !== "ok") {
      desired = size.side === "low" ? "closer" : "back";
      phase = "distance";
    } else if (chestHint) {
      desired = chestHint;
      phase = "distance";
    } else if (joint) {
      desired = joint;
      phase = "position";
    } else if (head.side !== "ok" || eye.side !== "ok") {
      desired = verticalSide === "high" ? "down" : "up";
      phase = "position";
    } else if (horizontal.side !== "ok") {
      desired = horizontal.side === "low" ? "left" : "right";
      phase = "position";
    } else if (input.rollDeg != null && Math.abs(input.rollDeg) > 4.5 && Math.abs(input.rollDeg) < 50) {
      desired = input.rollDeg > 0 ? "raiseRight" : "raiseLeft";
      phase = "position";
    } else {
      desired = input.steady ? "ready" : "hold";
      phase = "aligned";
    }
    const error = Math.max(
      sizeBand ? excess(sizeValue, sizeBand) : 0,
      excess(sample.eyeY, bands.eyeY),
      bands.headroom ? excess(sample.headroom, bands.headroom) : 0,
      excess(sample.centerX, bands.faceX),
      extent.complete ? 0 : 1.4,
    );
    if (desired === "ready" || desired === "hold") {
      if (this.memory.readySince == null) this.memory.readySince = input.now;
    } else this.memory.readySince = null;
    const hint = this.hold(desired, error, input.now);
    const aligned = hint === "ready" || hint === "hold";
    const shownSince = hint === this.memory.shown ? this.memory.shownSince : input.now;
    const stuck =
      hint === this.memory.shown &&
      input.now - shownSince > 1500 &&
      error > this.memory.errorAtShow - 0.05 &&
      hint !== "ready" &&
      hint !== "searching" &&
      hint !== "hold";
    const memory: SpecMemory = {
      shown: hint,
      pending: this.memory.pending,
      pendingSince: this.memory.pendingSince,
      shownSince,
      bestError: hint === this.memory.shown ? Math.min(this.memory.bestError, error) : error,
      errorAtShow: hint === this.memory.shown ? this.memory.errorAtShow : error,
      sizeOk: size.ok,
      eyeOk: eye.ok,
      headOk: head.ok,
      xOk: horizontal.ok,
      jointSince: this.memory.jointSince,
      readySince: this.memory.readySince,
      stuck,
    };
    this.memory = memory;
    const stage: "little" | "lot" | "none" = hint === "ready" || hint === "hold" || hint === "searching" ? "none" : error >= 0.85 ? "lot" : "little";
    this.lastStage = stage;
    const score = aligned ? Math.max(0.86, 1 - error / 2.2) : Math.max(0, Math.min(1, 1 - error / 2.2));
    const placed = placementFor(target, input.frame, this.config);
    return {
      hint,
      phase,
      error,
      score,
      aligned,
      magnitude: stage === "lot" ? 1.35 : stage === "little" ? 0.45 : Math.max(0, Math.min(3, error)),
      stage,
      stuck,
      rect: extent.rect,
      targetBox: placed.subjectBox,
      complete: extent.complete,
      memory,
    };
  }

  private chestHint(subject: Subject, crop: Rect, kind: "face" | "chest" | "body"): GuideHint | null {
    if (kind !== "chest" || subject.shouldersY == null) return null;
    const hips = subject.joints.filter((joint) => joint.name === "hip");
    if (!hips.length) return null;
    const hipY = hips.reduce((sum, joint) => sum + joint.y, 0) / hips.length;
    if (hipY <= subject.shouldersY) return null;
    const t = (crop.y + crop.h - subject.shouldersY) / (hipY - subject.shouldersY);
    const chest = this.config.cropBands.chest.safe;
    if (t < chest[0]) return "back";
    if (t > chest[1]) return "closer";
    return null;
  }

  private jointHint(subject: Subject, crop: Rect, now: number): GuideHint | null {
    const bottom = crop.y + crop.h;
    const knee = subject.joints.find((joint) => joint.name === "knee");
    const ankle = subject.joints.find((joint) => joint.name === "ankle");
    const forbid = this.config.cropBands.thigh.forbidNearTo;
    const head = Math.max(0.001, subject.chinY - subject.headTop);
    const chinBand = this.config.cropBands.forbidChinBandFracHeadH * head;
    let bad = false;
    if (Math.abs(bottom - subject.chinY) <= chinBand) bad = true;
    if (knee && Math.abs(bottom - knee.y) <= forbid * Math.max(0.05, (knee.y - (subject.shouldersY ?? knee.y)))) bad = true;
    if (ankle && bottom > ankle.y - this.config.cropBands.belowFeet.minGapBelowFeet && bottom < ankle.y + 0.02) bad = true;
    if (!bad) {
      this.memory.jointSince = null;
      return null;
    }
    if (this.memory.jointSince == null) this.memory.jointSince = now;
    if (now - this.memory.jointSince < this.config.hysteresis.cropBandMs) return null;
    return subject.eye.y < bottom - crop.h * 0.5 ? "down" : "up";
  }

  private hold(desired: GuideHint, error: number, now: number): GuideHint {
    const shown = this.memory.shown;
    if (desired === shown || shown === "searching" || desired === "searching") return desired;
    if (shown === "ready" && desired === "hold") return "ready";
    if (desired === "ready" || desired === "hold") {
      const since = this.memory.readySince ?? now;
      this.memory.readySince = since;
      if (now - since >= this.config.hysteresis.readyHoldMs) return desired;
      return shown;
    }
    const opposite = OPPOSITE[shown];
    if (desired === opposite && (error <= this.memory.bestError + 0.2 || now - this.reversedAt < 2000)) return shown;
    const pendingSince = desired === this.memory.pending ? this.memory.pendingSince : now;
    this.memory.pending = desired;
    this.memory.pendingSince = pendingSince;
    const dwell = this.config.hysteresis.hintDwellMs;
    const gap = this.config.hysteresis.hintGapMs;
    if (now - pendingSince >= dwell && now - this.memory.shownSince >= gap) {
      if (desired === opposite) this.reversedAt = now;
      return desired;
    }
    return shown;
  }
}
