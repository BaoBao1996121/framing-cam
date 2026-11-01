import type { Rect } from "../composition/types";

function center(box: Rect): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * The plan is stale when the subject left and did not move toward the target,
 * or their scale changed in the opposite direction of the plan.
 * Following the guide (moving toward the target) is not a scene change.
 */
export function planIsStale(anchor: Rect, current: Rect | null, target: Rect, missingMs: number): boolean {
  if (!current) return missingMs >= 800;
  const from = center(anchor);
  const now = center(current);
  const goal = center(target);
  const moved = Math.hypot(now.x - from.x, now.y - from.y);
  const progress = Math.hypot(from.x - goal.x, from.y - goal.y) - Math.hypot(now.x - goal.x, now.y - goal.y);
  if (moved > 0.28 && progress < 0.02) return true;
  const ratio = current.h / Math.max(0.04, anchor.h);
  const wanted = target.h / Math.max(0.04, anchor.h);
  if (ratio > 2.2 && wanted < 1.35) return true;
  if (ratio < 0.45 && wanted > 0.8) return true;
  return false;
}
