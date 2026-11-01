export type ShutterSnap = { canvas: HTMLCanvasElement; score: number; at: number; eyesOpen: boolean };

/** Sharpest eyes-open frame still inside the aligned window. */
export function pickShutterFrame(snaps: ShutterSnap[], now: number, windowMs = 900): ShutterSnap | null {
  let best: ShutterSnap | null = null;
  for (const snap of snaps) {
    if (!snap.eyesOpen) continue;
    if (now - snap.at > windowMs) continue;
    if (!best || snap.score > best.score) best = snap;
  }
  return best;
}
