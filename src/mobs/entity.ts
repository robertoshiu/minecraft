/**
 * entity.ts — the Mob entity: full mutable state + geometry/combat helpers.
 *
 * Conventions (match the player):
 *  - A solid voxel at integer coords (bx,by,bz) occupies [bx,bx+1] x [by,by+1] x [bz,bz+1].
 *  - `feet` is the reference point: centered on x/z, with y at the bottom of the
 *    AABB. A mob standing on top of the block at by=63 has feet.y === 64.
 *
 * This file fixes the FULL Mob shape so downstream AI modules never edit it.
 */

import { type MobType, MOB_STATS, PASSIVE_TYPES, HOSTILE_TYPES } from "../rules/mob-stats";

/** A 3D vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** An axis-aligned bounding box in world space. */
export interface MobAabb {
  min: Vec3;
  max: Vec3;
}

/** Finite-state AI states a mob can be in. */
export type AiState = "idle" | "wander" | "chase" | "attack" | "flee" | "fuse";

/**
 * Sentinel for `lastDamageTick` on a freshly-spawned mob: a large-negative value
 * so that `currentTick - lastDamageTick` is huge and the mob is never treated as
 * "recently damaged" before it has actually taken damage.
 */
export const NEVER_DAMAGED_TICK = -1_000_000;

/**
 * A live mob. All gameplay state lives here; AI modules mutate `aiState`,
 * `target`, `aiTimer`, etc. and physics mutates `feet`/`velocity`/`onGround`.
 */
export class Mob {
  readonly id: number;
  readonly type: MobType;

  /** Reference point: center x/z, bottom y. */
  feet: Vec3;
  /** Velocity in blocks/tick. */
  velocity: Vec3;
  /** Current health in half-hearts. */
  health: number;
  /** True iff resting on solid ground. */
  onGround: boolean;

  /** Current AI state. */
  aiState: AiState;
  /** Current navigation/look target, or null. */
  target: Vec3 | null;
  /** Facing angle (radians). */
  yaw: number;
  /** Age in ticks since spawn. */
  age: number;
  /** Tick of the most recent damage taken (see {@link NEVER_DAMAGED_TICK}). */
  lastDamageTick: number;
  /** Generic countdown used by AI states (ticks). */
  aiTimer: number;
  /** Ticks remaining before this mob can breed again. */
  breedCooldown: number;
  /** True while the mob is in "love mode" (ready to breed). */
  inLove: boolean;
  /** Creeper fuse countdown in ticks; -1 when not fusing. */
  fuseTimer: number;
  /** Scratch numeric state for AI extensions (no fixed schema). */
  extra: Record<string, number>;

  constructor(id: number, type: MobType, spawn: Vec3) {
    this.id = id;
    this.type = type;
    this.feet = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.health = MOB_STATS[type].maxHealth;
    this.onGround = false;
    this.aiState = "idle";
    this.target = null;
    this.yaw = 0;
    this.age = 0;
    this.lastDamageTick = NEVER_DAMAGED_TICK;
    this.aiTimer = 0;
    this.breedCooldown = 0;
    this.inLove = false;
    this.fuseTimer = -1;
    this.extra = {};
  }

  /** This mob's world-space AABB derived from `feet` + its type's size. */
  aabb(): MobAabb {
    const stats = MOB_STATS[this.type];
    const hw = stats.width / 2;
    return {
      min: { x: this.feet.x - hw, y: this.feet.y, z: this.feet.z - hw },
      max: {
        x: this.feet.x + hw,
        y: this.feet.y + stats.height,
        z: this.feet.z + hw,
      },
    };
  }

  /** True iff this mob is a passive type. */
  isPassive(): boolean {
    return PASSIVE_TYPES.includes(this.type);
  }

  /** True iff this mob is a hostile type. */
  isHostile(): boolean {
    return HOSTILE_TYPES.includes(this.type);
  }

  /**
   * Apply `n` half-hearts of damage at `currentTick`. Health is clamped at 0
   * and the damage tick is recorded (drives knockback/red-flash timing in AI).
   */
  takeDamage(n: number, currentTick: number): void {
    this.health -= n;
    if (this.health < 0) this.health = 0;
    this.lastDamageTick = currentTick;
  }

  /** True iff the mob's health has reached 0. */
  isDead(): boolean {
    return this.health <= 0;
  }
}
