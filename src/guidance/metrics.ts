const OPPOSITE: Record<string, string> = {
  left: "right",
  right: "left",
  up: "down",
  down: "up",
  closer: "back",
  back: "closer",
};

/** Local counters only. Nothing is uploaded. */
export class SessionMetrics {
  private hints: { t: number; hint: string }[] = [];
  private latencies: number[] = [];
  private started = 0;
  private convergedAt: number | null = null;

  reset(now: number): void {
    this.hints = [];
    this.latencies = [];
    this.started = now;
    this.convergedAt = null;
  }

  record(now: number, hint: string, computeMs: number): void {
    if (!this.started) this.started = now;
    this.latencies.push(computeMs);
    const previous = this.hints[this.hints.length - 1];
    if (!previous || previous.hint !== hint) this.hints.push({ t: now, hint });
    if ((hint === "ready" || hint === "steady") && this.convergedAt == null) this.convergedAt = now;
  }

  summary(now: number): {
    convergeMs: number | null;
    changes: number;
    reversals: number;
    reversalRate: number;
    flipsPerMin: number;
    computeP95Ms: number;
  } {
    let reversals = 0;
    for (let index = 1; index < this.hints.length; index += 1) {
      if (OPPOSITE[this.hints[index - 1].hint] === this.hints[index].hint) reversals += 1;
    }
    const changes = Math.max(0, this.hints.length - 1);
    const minutes = Math.max(1 / 60, (now - this.started) / 60000);
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
    return {
      convergeMs: this.convergedAt == null ? null : this.convergedAt - this.started,
      changes,
      reversals,
      reversalRate: changes ? reversals / changes : 0,
      flipsPerMin: changes / minutes,
      computeP95Ms: p95,
    };
  }
}
