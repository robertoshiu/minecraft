/**
 * controller.ts — grounded first-person player (camera/body split).
 *
 * The {@link Player} owns the body: a feet position, vertical physics state,
 * health, inventory + hotbar selection. {@link Player.update} advances the body
 * by exactly ONE fixed physics tick (1/20 s), composing horizontal input-driven
 * velocity with the per-tick vertical physics and resolving collisions via the
 * already-built swept-AABB {@link sweepMove}.
 *
 * FRAMERATE INDEPENDENCE: this module never reads wall-clock time. One call to
 * `update` == one Minecraft tick. The caller (main.ts) runs a fixed-timestep
 * accumulator and calls `update` once per accumulated 1/20 s, so movement speed
 * is identical regardless of render FPS.
 *
 * SPEED SCALING: PHYSICS.WALK_SPEED / SPRINT_SPEED are blocks/SECOND, so the
 * per-tick horizontal step is `speed / TICKS_PER_SECOND`. The vertical physics
 * (stepVerticalVelocity / JUMP_VEL / GRAVITY) is already expressed per-tick and
 * is used as-is.
 *
 * Pure logic + a tiny Vec3 type — NO Babylon imports.
 */

import { PHYSICS, TICKS_PER_SECOND, EXHAUSTION, type BlockId } from "../rules/mc-1.20";
import {
  makePhysicsState,
  tryJump,
  stepVerticalVelocity,
  onLand,
  accumulateFall,
  type PhysicsState,
} from "./physics";
import { sweepMove, type Vec3 } from "./collision";
import { Inventory, Hotbar } from "../inventory/inventory";
import { Equipment } from "../inventory/equipment";
import { makeEffectState, type EffectState } from "../effects/status";
import type { World } from "../world/world";
import {
  makeSurvivalState,
  tickSurvival,
  addExhaustion,
  canSprint,
  isDead,
  type SurvivalState,
} from "../survival/stats";
import { applyPlayerDamage } from "../combat/player-damage";

/** Per-frame movement intent (set by the input layer; read by update). */
export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
}

/** Vertical offset from feet to the camera/eye (Minecraft player eye height). */
const EYE_HEIGHT = 1.62;
/** Per-tick decay of the player's horizontal knockback channel (mirrors mobs). */
const KNOCKBACK_DECAY = 0.5;
/** Below this magnitude the knockback channel snaps to 0. */
const KNOCKBACK_EPSILON = 0.01;

/**
 * Grounded first-person player. `feet` is the swept-AABB reference point
 * (centered on x/z, y at the bottom of the body box — see collision.ts).
 */
export class Player {
  feet: Vec3;
  physics: PhysicsState;
  /** Full survival economy (health/food/saturation/exhaustion/timers). */
  survival: SurvivalState;
  readonly inventory: Inventory;
  readonly hotbar: Hotbar;
  readonly equipment: Equipment;
  /** Active status effects (potions). SEPARATE from SurvivalState. */
  readonly effects: EffectState;
  /**
   * Decaying horizontal knockback impulse (blocks/tick) on the XZ plane.
   * SEPARATE from PhysicsState (vertical-only). Blended into the input-derived
   * horizontal velocity each tick in update() and decayed toward 0 (Task 5).
   * The upward component rides physics.vy (see applyPlayerKnockback). Transient
   * — never persisted.
   */
  knockbackX = 0;
  knockbackZ = 0;
  private readonly spawn: Vec3;

  constructor(spawn: Vec3) {
    this.spawn = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.feet = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.physics = makePhysicsState();
    this.survival = makeSurvivalState();
    this.inventory = new Inventory();
    this.hotbar = new Hotbar();
    this.equipment = new Equipment();
    this.effects = makeEffectState();
  }

  /**
   * Current health (half-hearts). Backed by the survival state; kept as a
   * getter so existing callers/tests that read `player.health` keep working
   * while health itself lives in {@link SurvivalState}.
   */
  get health(): number {
    return this.survival.health;
  }

  /**
   * Advance the body by ONE fixed physics tick.
   *
   * @param input current movement intent.
   * @param yaw   camera yaw (radians) — forward maps to -Z rotated by yaw.
   * @param world the world to collide against (via {@link World.isSolidAt}).
   */
  update(
    input: InputState,
    yaw: number,
    world: World,
    speedMultiplier: number = 1,
    currentTick: number = -1,
  ): void {
    const wasOnGround = this.physics.onGround;

    // --- Horizontal desired velocity (blocks/tick) -------------------------
    // Local forward is -Z, local right is +X; rotate by yaw about the Y axis.
    let localX = 0;
    let localZ = 0;
    if (input.forward) localZ -= 1;
    if (input.back) localZ += 1;
    if (input.left) localX -= 1;
    if (input.right) localX += 1;

    // Sprinting requires intent AND enough food (canSprint gates on hunger).
    const sprinting = input.sprint && canSprint(this.survival);

    let hx = 0;
    let hz = 0;
    if (localX !== 0 || localZ !== 0) {
      const len = Math.hypot(localX, localZ);
      const nx = localX / len;
      const nz = localZ / len;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // Rotate the (nx, nz) direction by yaw around +Y.
      const worldX = nx * cos + nz * sin;
      const worldZ = -nx * sin + nz * cos;

      const baseSpeed = sprinting ? PHYSICS.SPRINT_SPEED : PHYSICS.WALK_SPEED;
      const speed = baseSpeed * speedMultiplier;
      const perTick = speed / TICKS_PER_SECOND;
      hx = worldX * perTick;
      hz = worldZ * perTick;
    }

    // --- Knockback channel: add the decaying impulse to the horizontal move,
    // then decay it (mirrors mobs/physics.ts). The upward component was already
    // written to physics.vy by applyPlayerKnockback and rides the vertical
    // integrator below.
    hx += this.knockbackX;
    hz += this.knockbackZ;
    this.knockbackX *= KNOCKBACK_DECAY;
    this.knockbackZ *= KNOCKBACK_DECAY;
    if (Math.abs(this.knockbackX) < KNOCKBACK_EPSILON) this.knockbackX = 0;
    if (Math.abs(this.knockbackZ) < KNOCKBACK_EPSILON) this.knockbackZ = 0;

    // --- Vertical: jump gating + per-tick velocity integration -------------
    if (input.jump) {
      // A successful jump adds jump exhaustion (sprint-jumps cost more).
      if (tryJump(this.physics)) {
        addExhaustion(
          this.survival,
          sprinting ? EXHAUSTION.SPRINT_JUMP : EXHAUSTION.JUMP,
        );
      }
    }
    const dy = stepVerticalVelocity(this.physics);

    // --- Resolve movement against the world --------------------------------
    const before = this.feet;
    const velocity: Vec3 = { x: hx, y: dy, z: hz };
    const result = sweepMove(this.feet, velocity, (bx, by, bz) =>
      world.isSolidAt(bx, by, bz),
    );
    this.feet = result.feet;

    // Sprinting costs exhaustion per metre actually travelled horizontally
    // (use the resolved delta so blocked movement doesn't drain hunger).
    if (sprinting) {
      const movedX = this.feet.x - before.x;
      const movedZ = this.feet.z - before.z;
      const dist = Math.hypot(movedX, movedZ);
      if (dist > 0) {
        addExhaustion(this.survival, EXHAUSTION.SPRINT_PER_M * dist);
      }
    }

    // Accumulate fall distance while airborne and actually descending.
    if (!result.onGround && dy < 0) {
      accumulateFall(this.physics, -dy);
    }

    // Landing transition: airborne → grounded applies fall damage.
    this.physics.onGround = result.onGround;
    if (result.onGround && !wasOnGround) {
      const fall = onLand(this.physics);
      if (fall > 0) {
        applyPlayerDamage(this, fall, currentTick, "fall");
      }
    }

    // Advance the survival economy one tick (regen/starvation/timers).
    tickSurvival(this.survival);

    // Death is intentionally NOT auto-respawned here: the game loop observes
    // `isDead(player.survival)` to show the death screen and freeze ticks, then
    // calls {@link Player.respawn} from the Respawn button. See main.ts.
  }

  /** True once the player's health has reached 0. */
  isDead(): boolean {
    return isDead(this.survival);
  }

  /** The world spawn point this player respawns to by default. */
  get spawnPoint(): Vec3 {
    return { x: this.spawn.x, y: this.spawn.y, z: this.spawn.z };
  }

  /** Update the bed/world spawn point (set when sleeping in a bed). */
  setSpawn(p: Vec3): void {
    this.spawn.x = p.x;
    this.spawn.y = p.y;
    this.spawn.z = p.z;
  }

  /** Camera/eye position: feet plus the eye-height offset. */
  eyePosition(): Vec3 {
    return { x: this.feet.x, y: this.feet.y + EYE_HEIGHT, z: this.feet.z };
  }

  /** Reset the body to `spawn` with a full survival state and fresh physics. */
  respawn(spawn: Vec3): void {
    this.feet = { x: spawn.x, y: spawn.y, z: spawn.z };
    this.physics = makePhysicsState();
    this.survival = makeSurvivalState();
    this.effects.list.length = 0;
    this.knockbackX = 0;
    this.knockbackZ = 0;
  }
}

/** Convenience: the block id the player is currently holding, or null. */
export function heldBlockId(player: Player): BlockId | null {
  const stack = player.hotbar.selectedStack(player.inventory);
  if (stack === null || stack.count <= 0) return null;
  return stack.itemId as BlockId;
}
