/**
 * physics.ts — pure vertical-motion logic for the player.
 *
 * This module is deliberately framework-free: NO Babylon, NO world/collision
 * access. It owns only the math of a single body's vertical velocity, jump
 * gating, and fall-distance / fall-damage accounting.
 *
 * The integrator (a separate module) is responsible for:
 *   - applying the returned y-delta to a position,
 *   - running the collision query, and
 *   - telling this module when the body becomes grounded (via {@link onLand})
 *     or accumulates downward fall distance (via {@link accumulateFall}).
 *
 * All magic numbers originate in src/rules/mc-1.20.ts.
 */

import { PHYSICS, FALL } from "../rules/mc-1.20";

/**
 * Mutable per-player vertical-physics state.
 *
 * - `vy`            current vertical velocity (blocks/tick; +up, -down).
 * - `onGround`      whether the body is currently resting on a surface.
 *                   Set ONLY by the integrator/collision (via onLand) and by
 *                   tryJump (which clears it on lift-off). Never by stepping.
 * - `fallDistance`  cumulative downward distance fallen while airborne
 *                   (blocks, always >= 0). Reset on landing.
 * - `jumpCooldown`  ticks remaining before another jump is allowed (>= 0).
 */
export interface PhysicsState {
  vy: number;
  onGround: boolean;
  fallDistance: number;
  jumpCooldown: number;
}

/** Create a fresh, airborne-at-rest physics state. */
export function makePhysicsState(): PhysicsState {
  return { vy: 0, onGround: false, fallDistance: 0, jumpCooldown: 0 };
}

/**
 * Attempt to jump.
 *
 * Succeeds only when grounded and off cooldown. On success the body is given
 * its initial upward velocity, the cooldown is armed, and `onGround` is
 * cleared so the very next integration step treats the body as airborne.
 *
 * @returns true if the jump was initiated, false otherwise.
 */
export function tryJump(state: PhysicsState): boolean {
  if (!state.onGround || state.jumpCooldown !== 0) {
    return false;
  }
  state.vy = PHYSICS.JUMP_VEL;
  state.jumpCooldown = PHYSICS.JUMP_COOLDOWN_TICKS;
  state.onGround = false;
  return true;
}

/**
 * Advance ONE tick of vertical velocity.
 *
 * Applies gravity then air drag (`vy = (vy - GRAVITY) * DRAG`) and clamps the
 * result so the body never falls faster than terminal velocity. Also decays
 * the jump cooldown toward zero.
 *
 * Does NOT touch `onGround` — grounding is decided by the collision module,
 * which calls {@link onLand} when contact is made.
 *
 * @returns the new `vy`, i.e. the y-delta the integrator should apply to the
 *          body's position for THIS tick.
 */
export function stepVerticalVelocity(state: PhysicsState): number {
  let vy = (state.vy - PHYSICS.GRAVITY) * PHYSICS.DRAG;
  if (vy < PHYSICS.TERMINAL_VEL) {
    vy = PHYSICS.TERMINAL_VEL;
  }
  state.vy = vy;

  if (state.jumpCooldown > 0) {
    state.jumpCooldown -= 1;
  }

  return vy;
}

/**
 * Notify that the body has just become grounded after being airborne.
 *
 * Computes fall damage from the accumulated fall distance, then resets the
 * fall accounting, zeroes vertical velocity, and marks the body grounded.
 *
 * @returns fall damage to apply (half-hearts, >= 0).
 */
export function onLand(state: PhysicsState): number {
  const damage = fallDamage(state.fallDistance);
  state.fallDistance = 0;
  state.vy = 0;
  state.onGround = true;
  return damage;
}

/**
 * Accumulate downward fall distance while airborne and descending.
 *
 * @param dyDown the downward distance travelled this tick, as a POSITIVE
 *               number of blocks. Non-positive values are ignored so callers
 *               can pass raw deltas without sign bookkeeping.
 */
export function accumulateFall(state: PhysicsState, dyDown: number): void {
  if (dyDown > 0) {
    state.fallDistance += dyDown;
  }
}

/**
 * Fall damage (half-hearts) for a given fall distance (blocks).
 *
 * The first {@link FALL.SAFE_BLOCKS} blocks are free; every whole block beyond
 * that deals {@link FALL.DAMAGE_PER_BLOCK}.
 */
export function fallDamage(fallDistance: number): number {
  return (
    Math.max(0, Math.floor(fallDistance - FALL.SAFE_BLOCKS)) *
    FALL.DAMAGE_PER_BLOCK
  );
}
