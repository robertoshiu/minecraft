/**
 * entity.ts — the thrown SplashPotion entity (Phase 6b). Cloned from the
 * kinematic Arrow: position + velocity, swept per tick by splashPotionStep. It
 * carries the potion effect to apply in a radius on burst. No health/AI.
 */

import type { Vec3 } from "../mobs/entity";
import type { EffectType } from "../effects/status";
import { SPLASH } from "../rules/mc-1.20";
import { launchProjectile } from "../projectile/launch";

/** The effect a splash potion delivers on burst. */
export interface SplashEffect {
  type: EffectType;
  amplifier: number;
  durationTicks: number;
}

/** A single in-flight (or just-burst) splash potion. */
export class SplashPotion {
  readonly id: number;
  feet: Vec3;
  velocity: Vec3;
  /** True once it has hit a block or mob and applied its AoE (pending cleanup). */
  burst: boolean;
  age: number;
  readonly effect: SplashEffect;

  constructor(id: number, origin: Vec3, velocity: Vec3, effect: SplashEffect) {
    this.id = id;
    this.feet = { x: origin.x, y: origin.y, z: origin.z };
    this.velocity = { x: velocity.x, y: velocity.y, z: velocity.z };
    this.burst = false;
    this.age = 0;
    this.effect = effect;
  }

  isDone(maxAge: number): boolean {
    return this.burst || this.age >= maxAge;
  }
}

/** Compute the spawn origin + velocity from an eye + aim dir + speed. */
export function launchSplashFrom(
  eye: Vec3,
  aimDir: Vec3,
  speed: number = SPLASH.SPEED,
): { origin: Vec3; velocity: Vec3 } {
  return launchProjectile(eye, aimDir, speed, SPLASH.SPAWN_OFFSET);
}
