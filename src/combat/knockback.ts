/**
 * knockback.ts — PURE knockback-impulse vector math.
 *
 * Given the attacker's XZ position and the mob's feet, returns a velocity
 * impulse (blocks/tick) pointing away from the attacker on the XZ plane plus a
 * small fixed upward component. Player knockback is DEFERRED (the player body
 * recomputes horizontal velocity from input each tick — no impulse channel),
 * so this is used only for MOBS.
 */

import type { Vec3 } from "../mobs/entity";

/** Horizontal knockback speed (blocks/tick) applied to a struck mob. */
export const KNOCKBACK_HORIZONTAL = 0.4;
/** Upward knockback speed (blocks/tick). */
export const KNOCKBACK_UPWARD = 0.36;

/**
 * Impulse pushing a mob away from `attackerXZ`. The XZ direction is
 * normalized; a zero-length separation (attacker exactly on the mob) yields a
 * default +X push so the mob is never left motionless.
 */
export function knockbackImpulse(
  attackerXZ: { x: number; z: number },
  mobFeet: { x: number; z: number },
  strength: number = KNOCKBACK_HORIZONTAL,
): Vec3 {
  let dx = mobFeet.x - attackerXZ.x;
  let dz = mobFeet.z - attackerXZ.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    dx = 1;
    dz = 0;
  } else {
    dx /= len;
    dz /= len;
  }
  return { x: dx * strength, y: KNOCKBACK_UPWARD, z: dz * strength };
}
