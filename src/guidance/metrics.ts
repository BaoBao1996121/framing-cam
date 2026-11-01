const OPPOSITE: Record<string, string> = {
  left: "right",
  right: "left",
  up: "down",
  down: "up",
  closer: "back",
  back: "closer",
};

/** Hold and ready are the same settled state. Switching between them is not a new instruction. */
function token(hint: string): string {
  if (hint === "hold" || hint === "ready") return "aligned";
  return hint;
}

/** Local counters only. Nothing is uploaded. */
export class SessionMetrics {
  private hints: { t: number; hint: string }[] = [];
  private latencies: number[] = [];
  private started = 0;
  private clock = false;
  private firstHintAt: number | null = null;
  private readyAt: number | null = null;
  private captureAt: number | null = null;

  reset(now: number): void {
    this.hints = [];
    this.latencies = [];
    this.started = now;
    this.clock = true;
    this.firstHintAt = null;
    this.readyAt = null;
    this.captureAt = null;
  }

  record(now: number, hint: string, computeMs: number): void {
    if (!this.clock) {
      this.clock = true;
      this.started = now;
    }
    this.latencies.push(computeMs);
    const shown = token(hint);
    const previous = this.hints[this.hints.length - 1];
    if (!previous || previous.hint !== shown) this.hints.push({ t: now, hint: shown });
    if (shown !== "searching" && this.firstHintAt == null) this.firstHintAt = now;
    if (shown === "aligned" && this.readyAt == null) this.readyAt = now;
  }

  /** The shutter actually fired. Separate from the moment the guide first said ready. */
  markCapture(now: number): void {
    if (this.captureAt == null) this.captureAt = now;
  }

  summary(now: number, captureHoldMs = 1000): {
    timeToFirstHintMs: number | null;
    timeToReadyMs: number | null;
    timeToCaptureMs: number | null;
    progressions: number;
    flips: number;
    flipsPerMin: number;
    progressionPerMin: number;
    computeP95Ms: number;
  } {
    let flips = 0;
    let progressions = 0;
    for (let index = 1; index < this.hints.length; index += 1) {
      const previous = this.hints[index - 1].hint;
      const next = this.hints[index].hint;
      const returned = this.hints.slice(0, index - 1).some((item) => item.hint === next);
      if (OPPOSITE[previous] === next || returned) flips += 1;
      else progressions += 1;
    }
    const minutes = Math.max(1 / 60, (now - this.started) / 60000);
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    const readyMs = this.readyAt == null ? null : this.readyAt - this.started;
    const captureMs = this.captureAt != null ? this.captureAt - this.started : readyMs == null ? null : readyMs + captureHoldMs;
    return {
      timeToFirstHintMs: this.firstHintAt == null ? null : this.firstHintAt - this.started,
      timeToReadyMs: readyMs,
      timeToCaptureMs: captureMs,
      progressions,
      flips,
      flipsPerMin: flips / minutes,
      progressionPerMin: progressions / minutes,
      computeP95Ms: p95,
    };
  }
}
