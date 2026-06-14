/**
 * game-effects.ts — thin mapping glue between game events and ParticleManager.
 *
 * GameEffects translates high-level game events (block break, footstep, mob
 * death, etc.) into the correct ParticleManager calls, choosing the right
 * colour for each event type. It is a pure orchestration layer — no particle
 * construction here.
 *
 * The class is fully testable by injecting a mock ParticleManager.
 */

import type { MobType } from "../rules/mob-stats";
import { blockDebrisColor } from "./particles";
import type { ParticleManager } from "./particles";

// ---------------------------------------------------------------------------
// Per-mob tint colours (RGB in [0,1])
// ---------------------------------------------------------------------------

/** Visual tint for each mob type's hurt/death particles. */
const MOB_TINTS: Record<MobType, [number, number, number]> = {
  zombie:   [0.2, 0.5, 0.15], // greenish
  skeleton: [0.85, 0.85, 0.85], // bone-white
  creeper:  [0.25, 0.65, 0.25], // bright green
  cow:      [0.5, 0.4, 0.3],   // brown hide
  pig:      [0.9, 0.65, 0.6],  // pink
  sheep:    [0.85, 0.85, 0.82], // off-white wool
  chicken:  [0.9, 0.85, 0.6],  // pale yellow
};

// ---------------------------------------------------------------------------
// GameEffects
// ---------------------------------------------------------------------------

/** A Vec3 as accepted by ParticleManager methods. */
interface Pos3 {
  x: number;
  y: number;
  z: number;
}

/**
 * High-level game effects interface. Wraps a {@link ParticleManager} and maps
 * game events to named particle bursts with appropriate colours.
 */
export class GameEffects {
  private readonly manager: ParticleManager;

  constructor(manager: ParticleManager) {
    this.manager = manager;
  }

  // --- Block interactions --------------------------------------------------

  /**
   * Block was broken. Emits coloured debris particles matching the block.
   *
   * @param blockId  The numeric block ID of the block that was broken.
   * @param pos      World position at the centre of the block.
   */
  onBreak(blockId: number, pos: Pos3): void {
    const color = blockDebrisColor(blockId);
    this.manager.blockBreak(pos, color);
  }

  /**
   * Block was placed. Emits a small neutral puff.
   *
   * @param pos  World position at the centre of the placed block.
   */
  onPlace(pos: Pos3): void {
    this.manager.blockPlace(pos);
  }

  /**
   * Player took a footstep. Emits subtle ground-dust coloured by underfoot block.
   *
   * @param blockId  The block directly underfoot.
   * @param pos      Player feet position.
   */
  onFootstep(blockId: number, pos: Pos3): void {
    const color = blockDebrisColor(blockId);
    this.manager.footstep(pos, color);
  }

  // --- Explosion -----------------------------------------------------------

  /**
   * An explosion occurred. Emits a large smoke/debris cloud.
   *
   * @param pos  World position at the explosion centre.
   */
  onExplosion(pos: Pos3): void {
    this.manager.explosion(pos);
  }

  // --- Mob events ----------------------------------------------------------

  /**
   * A mob took damage. Emits a small coloured spark burst.
   *
   * @param type  The mob type (drives tint colour).
   * @param pos   Mob feet position.
   */
  onMobHurt(type: MobType, pos: Pos3): void {
    const color = MOB_TINTS[type];
    this.manager.mobHurt(pos, color);
  }

  /**
   * A mob died. Emits a larger coloured burst.
   *
   * @param type  The mob type (drives tint colour).
   * @param pos   Mob feet position.
   */
  onMobDeath(type: MobType, pos: Pos3): void {
    const color = MOB_TINTS[type];
    this.manager.mobDeath(pos, color);
  }
}
