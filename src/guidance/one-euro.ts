/** One Euro filter. Low jitter when still, low lag when the subject moves. */
export class OneEuro {
  private y = 0;
  private dy = 0;
  private time = 0;
  private started = false;

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.02,
    private readonly derivativeCutoff = 1,
  ) {}

  filter(value: number, timeMs: number): number {
    if (!this.started) {
      this.started = true;
      this.y = value;
      this.time = timeMs;
      return value;
    }
    const dt = Math.max(0.001, (timeMs - this.time) / 1000);
    this.time = timeMs;
    const derivative = (value - this.y) / dt;
    const alphaD = alpha(dt, this.derivativeCutoff);
    this.dy = this.dy + alphaD * (derivative - this.dy);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dy);
    const alphaY = alpha(dt, cutoff);
    this.y = this.y + alphaY * (value - this.y);
    return this.y;
  }
}

function alpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class RectFilter {
  private readonly x = new OneEuro();
  private readonly y = new OneEuro();
  private readonly w = new OneEuro(1, 0.01);
  private readonly h = new OneEuro(1, 0.01);

  filter(rect: { x: number; y: number; w: number; h: number }, timeMs: number) {
    return {
      x: this.x.filter(rect.x, timeMs),
      y: this.y.filter(rect.y, timeMs),
      w: this.w.filter(rect.w, timeMs),
      h: this.h.filter(rect.h, timeMs),
    };
  }
}
