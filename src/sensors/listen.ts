import { chooseRoll, linearAccelerationG } from "./level";

type Vec3 = { x: number; y: number; z: number };

export class MotionLevel {
  gravity: Vec3 | null = null;
  gamma: number | null = null;
  beta: number | null = null;
  linearG: number | null = null;
  /** Degrees per second of device gamma. Zero when orientation events are absent. */
  gammaPerSec = 0;
  private gammaSample: { value: number; time: number } | null = null;

  roll(): number | null {
    return chooseRoll({ gravity: this.gravity, gamma: this.gamma, beta: this.beta });
  }

  async request(): Promise<void> {
    const host = globalThis as typeof globalThis & {
      DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
      DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
    };
    const asks: Promise<unknown>[] = [];
    const motion = host.DeviceMotionEvent;
    const orientation = host.DeviceOrientationEvent;
    if (typeof motion?.requestPermission === "function") {
      asks.push(motion.requestPermission().catch(() => "denied"));
    }
    if (typeof orientation?.requestPermission === "function") {
      asks.push(orientation.requestPermission().catch(() => "denied"));
    }
    await Promise.all(asks);
    window.addEventListener("deviceorientation", this.onOrientation);
    window.addEventListener("devicemotion", this.onMotion);
  }

  stop(): void {
    window.removeEventListener("deviceorientation", this.onOrientation);
    window.removeEventListener("devicemotion", this.onMotion);
  }

  private onOrientation = (event: DeviceOrientationEvent): void => {
    const now = performance.now();
    if (event.gamma != null && this.gammaSample) {
      const dt = (now - this.gammaSample.time) / 1000;
      if (dt > 0.016 && dt < 0.5) {
        let delta = event.gamma - this.gammaSample.value;
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        this.gammaPerSec = delta / dt;
      }
    }
    if (event.gamma != null) this.gammaSample = { value: event.gamma, time: now };
    this.gamma = event.gamma;
    this.beta = event.beta;
  };

  private onMotion = (event: DeviceMotionEvent): void => {
    const gravity = event.accelerationIncludingGravity;
    if (gravity && gravity.x != null && gravity.y != null && gravity.z != null) {
      this.gravity = { x: gravity.x, y: gravity.y, z: gravity.z };
    }
    const acceleration = event.acceleration;
    if (acceleration && acceleration.x != null && acceleration.y != null && acceleration.z != null) {
      this.linearG = linearAccelerationG(
        { x: acceleration.x, y: acceleration.y, z: acceleration.z },
        this.gravity,
      );
    }
  };
}
