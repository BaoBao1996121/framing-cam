export function normalizeDegrees(degrees: number): number {
  let value = degrees;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

/**
 * Roll of a portrait phone from acceleration that includes gravity.
 * Device axes: x to the right, y toward the top of the screen.
 * Positive means the right side is lower.
 * Returns null when the phone is lying flat, where this projection is meaningless.
 */
export function rollFromGravity(x: number, y: number, z: number): number | null {
  if (![x, y, z].every(Number.isFinite)) return null;
  const magnitude = Math.hypot(x, y, z);
  if (magnitude < 0.2) return null;
  if (Math.hypot(x, y) < magnitude * 0.28) return null;
  return normalizeDegrees((Math.atan2(x, -y) * 180) / Math.PI);
}

/** Gamma is positive when the device is tipped toward the right (MDN). */
export function rollFromGamma(gamma: number | null, beta: number | null): number | null {
  if (gamma == null || !Number.isFinite(gamma)) return null;
  if (beta != null && Number.isFinite(beta) && Math.abs(Math.abs(beta) - 90) > 55) return null;
  return normalizeDegrees(gamma);
}

export function chooseRoll(input: {
  gravity: { x: number; y: number; z: number } | null;
  gamma: number | null;
  beta: number | null;
}): number | null {
  if (input.gravity) {
    const fromGravity = rollFromGravity(input.gravity.x, input.gravity.y, input.gravity.z);
    if (fromGravity != null) return fromGravity;
  }
  return rollFromGamma(input.gamma, input.beta);
}

export function linearAccelerationG(
  acceleration: { x: number; y: number; z: number } | null,
  gravity: { x: number; y: number; z: number } | null,
): number | null {
  if (!acceleration) return null;
  const magnitude = Math.hypot(acceleration.x, acceleration.y, acceleration.z);
  if (!Number.isFinite(magnitude)) return null;
  const gravityMagnitude = gravity ? Math.hypot(gravity.x, gravity.y, gravity.z) : 0;
  const unit = gravityMagnitude > 0.2 && gravityMagnitude < 2.5 ? 1 : magnitude > 0 && magnitude < 2.5 && !gravity ? 1 : 9.81;
  return magnitude / unit;
}
