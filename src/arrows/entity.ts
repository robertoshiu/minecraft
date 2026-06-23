/**
 * entity.ts — the kinematic Arrow entity (Phase 5).
 *
 * An Arrow is NEVER a physics body: it carries a position (feet) + velocity and
 * is swept per-tick by arrowStep (src/arrows/physics.ts). Minimal state — no
 * health, no AI, no knockback. Vec3 is imported from the mob entity module so
 * Arrow positions are directly comparable with mob AABBs (pickMob).
 */

import type { Vec3 } from "../mobs/entity";
import { ARROW } from "../rules/mc-1.20";
import type { EffectType } from "../effects/status";
import { launchProjectile } from "../projectile/launch";

export const ARROW_WIDTH = ARROW.WIDTH;
export const ARROW_LENGTH = ARROW.LENGTH;

/** A single in-flight (or just-landed) arrow. */
export class Arrow {
  readonly id: number;
  /** Tip/reference position in world space. */
  feet: Vec3;
  /** Velocity in blocks/tick. */
  velocity: Vec3;
  /** True once the arrow has struck a block (stops moving; pending cleanup). */
  landed: boolean;
  /** True once the arrow has struck a mob (pending cleanup). */
  hitMob: boolean;
  /** Id of the mob that fired/owns the arrow context (player = -1). */
  readonly shooterId: number;
  /** Age in ticks since spawn (drives the MAX_AGE despawn). */
  age: number;
  /**
   * Optional tipped-arrow effect applied on a mob hit (Phase 6b). undefined for
   * a plain arrow. Adding it OPTIONAL keeps the entity shape back-compatible.
   */
  readonly potionEffect?: { type: EffectType; amplifier: number; durationTicks: number };

  constructor(
    id: number,
    origin: Vec3,
    velocity: Vec3,
    shooterId = -1,
    potionEffect?: { type: EffectType; amplifier: number; durationTicks: number },
  ) {
    this.id = id;
    this.feet = { x: origin.x, y: origin.y, z: origin.z };
    this.velocity = { x: velocity.x, y: velocity.y, z: velocity.z };
    this.landed = false;
    this.hitMob = false;
    this.shooterId = shooterId;
    this.age = 0;
    if (potionEffect !== undefined) {
      (this as { potionEffect?: typeof potionEffect }).potionEffect = potionEffect;
    }
  }

  /** True once the arrow should be removed from the manager. */
  isDone(maxAge: number): boolean {
    return this.landed || this.hitMob || this.age >= maxAge;
  }
}

/**
 * Map a bow hold time (ms) to a launch speed (blocks/tick), clamped between
 * MIN_SPEED and MAX_SPEED. Linear in the 0..FULL_CHARGE_MS window.
 */
export function bowChargeToSpeed(chargeMs: number): number {
  const t = Math.max(0, Math.min(1, chargeMs / ARROW.FULL_CHARGE_MS));
  return ARROW.MIN_SPEED + t * (ARROW.MAX_SPEED - ARROW.MIN_SPEED);
}

/**
 * Compute the arrow spawn origin + velocity from an eye position, a (possibly
 * unnormalized) aim direction, and a launch speed. The origin is pushed
 * SPAWN_OFFSET blocks along the aim so the arrow clears the shooter's own body
 * (raycastVoxel checks the origin voxel first — spawning inside a wall would
 * self-hit).
 */
export function launchFrom(
  eye: Vec3,
  aimDir: Vec3,
  speed: number,
): { origin: Vec3; velocity: Vec3 } {
  return launchProjectile(eye, aimDir, speed, ARROW.SPAWN_OFFSET);
}
