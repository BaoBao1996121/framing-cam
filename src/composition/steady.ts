export class SteadyDetector {
  private samples: { t: number; x: number; y: number }[] = [];
  private accel: { t: number; g: number }[] = [];

  reset(): void {
    this.samples = [];
    this.accel = [];
  }

  pushLandmark(time: number, x: number, y: number): void {
    this.samples.push({ t: time, x, y });
    this.samples = this.samples.filter((sample) => time - sample.t <= 800);
  }

  /** `linearG` is the magnitude of linear acceleration in g. */
  pushAccel(time: number, linearG: number | null): void {
    if (linearG == null || !Number.isFinite(linearG)) return;
    this.accel.push({ t: time, g: linearG });
    this.accel = this.accel.filter((sample) => time - sample.t <= 800);
  }

  isSteady(now: number): boolean {
    const recent = this.samples.filter((sample) => now - sample.t <= 500);
    if (recent.length < 4) return false;
    if (recent[recent.length - 1].t - recent[0].t < 450) return false;
    const meanX = average(recent.map((sample) => sample.x));
    const meanY = average(recent.map((sample) => sample.y));
    const variance = recent.reduce((sum, sample) => sum + (sample.x - meanX) ** 2 + (sample.y - meanY) ** 2, 0) / recent.length;
    const spread = Math.sqrt(variance);
    if (spread > 0.012) return false;
    const motion = this.accel.filter((sample) => now - sample.t <= 500);
    if (motion.length >= 3) {
      const rms = Math.sqrt(motion.reduce((sum, sample) => sum + sample.g * sample.g, 0) / motion.length);
      if (rms > 0.18 && spread > 0.007) return false;
    }
    return true;
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class AutoShutter {
  private latched = false;

  /** Fires once when `ready` becomes true. `ready` already includes the 0.5s steady window. */
  update(ready: boolean): boolean {
    if (!ready) {
      this.latched = false;
      return false;
    }
    if (this.latched) return false;
    this.latched = true;
    return true;
  }
}
