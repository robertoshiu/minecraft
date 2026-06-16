/**
 * aoe.ts — PURE radius selection for splash-potion bursts (Phase 6b).
 *
 * Mobs have NO EffectState, so the burst applies the potion EFFECT to the
 * player (when in range) and plain instant DAMAGE to mobs in range. This module
 * only SELECTS targets by distance; the caller (main.ts) decides effect vs
 * damage. No mutation here.
 */

import type { Vec3, Mob } from "../mobs/entity";

/** Euclidean distance from `a` to `b`. */
function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** True iff `point` is within `radius` blocks of `center`. */
export function withinRadius(center: Vec3, point: Vec3, radius: number): boolean {
  return dist(center, point) <= radius;
}

/**
 * Select burst targets. Returns the mobs whose body-center (feet.y + 0.5) is
 * within `radius` of the burst center, and whether the player (by feet) is in
 * range. Pure: never mutates the mobs.
 */
export function splashTargets(
  center: Vec3,
  playerFeet: Vec3,
  mobs: readonly Mob[],
  radius: number,
): { mobs: Mob[]; playerInRange: boolean } {
  const hitMobs: Mob[] = [];
  for (const m of mobs) {
    const body: Vec3 = { x: m.feet.x, y: m.feet.y + 0.5, z: m.feet.z };
    if (withinRadius(center, body, radius)) hitMobs.push(m);
  }
  return { mobs: hitMobs, playerInRange: withinRadius(center, playerFeet, radius) };
}
