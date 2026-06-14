/**
 * game-audio.ts — thin mapping glue between game events and the AudioEngine.
 *
 * GameAudio translates high-level game events (block break, footstep, mob
 * spawn, explosion, etc.) into the correct engine.playSfx / startAmbient
 * calls. It is a pure orchestration layer — no synthesis logic here.
 *
 * The class is fully testable by injecting a mock AudioEngine.
 */

import type { Vec3 } from "./spatial";
import type { MobType } from "../rules/mob-stats";
import type { Biome } from "../world/biome";
import { blockBreakSound, placeSound, footstepSound } from "./specs";

// ---------------------------------------------------------------------------
// Minimal subset of AudioEngine that GameAudio needs (aids mock injection).
// ---------------------------------------------------------------------------

/** The subset of AudioEngine that GameAudio calls. */
export interface AudioEngineLike {
  playSfx(name: string, opts?: { position?: Vec3; pitch?: number; rng?: () => number }): void;
  startAmbient(name: string): void;
  stopAmbient(): void;
  updateListener(pos: Vec3, yaw: number): void;
}

// ---------------------------------------------------------------------------
// Per-mob ambient sound mapping
// ---------------------------------------------------------------------------

const MOB_SPAWN_SOUNDS: Record<MobType, string> = {
  zombie: "mob_zombie",
  skeleton: "mob_skeleton",
  creeper: "mob_creeper_hiss",
  cow: "mob_cow",
  pig: "mob_pig",
  sheep: "mob_sheep",
  chicken: "mob_chicken",
};

const MOB_DEATH_SOUNDS: Record<MobType, string> = {
  zombie: "mob_death",
  skeleton: "mob_death",
  creeper: "mob_death",
  cow: "mob_death",
  pig: "mob_death",
  sheep: "mob_death",
  chicken: "mob_death",
};

// ---------------------------------------------------------------------------
// GameAudio
// ---------------------------------------------------------------------------

/**
 * High-level game audio interface. Wraps an {@link AudioEngineLike} and maps
 * game events to named sound effects.
 */
export class GameAudio {
  private readonly engine: AudioEngineLike;

  constructor(engine: AudioEngineLike) {
    this.engine = engine;
  }

  // --- Block interactions --------------------------------------------------

  /**
   * Called when a block is broken. Plays the appropriate break sound at the
   * block's world position.
   */
  onBreak(blockId: number, pos: Vec3): void {
    this.engine.playSfx(blockBreakSound(blockId), { position: pos });
  }

  /**
   * Called when a block is placed. Plays a generic placement thud.
   */
  onPlace(pos: Vec3): void {
    this.engine.playSfx(placeSound(), { position: pos });
  }

  /**
   * Called each footstep. Plays the surface-appropriate footstep sound.
   *
   * @param blockId  The block directly beneath the player's feet.
   * @param pos      The player's position (for spatial audio).
   */
  onFootstep(blockId: number, pos: Vec3): void {
    this.engine.playSfx(footstepSound(blockId), { position: pos });
  }

  // --- Mob events ----------------------------------------------------------

  /**
   * Called when a mob spawns. Plays an idle/spawn ambient for that mob type.
   */
  onMobSpawn(type: MobType, pos: Vec3): void {
    const name = MOB_SPAWN_SOUNDS[type];
    this.engine.playSfx(name, { position: pos });
  }

  /**
   * Called when any mob takes damage. Plays a generic hurt sound.
   */
  onMobHurt(pos: Vec3): void {
    this.engine.playSfx("mob_hurt", { position: pos });
  }

  /**
   * Called when a mob dies. Plays a type-appropriate death sound.
   */
  onMobDeath(type: MobType, pos: Vec3): void {
    const name = MOB_DEATH_SOUNDS[type];
    this.engine.playSfx(name, { position: pos });
  }

  /**
   * Called when a creeper starts its fuse (arming for detonation).
   * Plays the characteristic hiss.
   */
  onCreeperFuse(pos: Vec3): void {
    this.engine.playSfx("mob_creeper_hiss", { position: pos });
  }

  /**
   * Called when an explosion occurs (creeper detonation, etc.).
   */
  onExplosion(pos: Vec3): void {
    this.engine.playSfx("explosion", { position: pos });
  }

  // --- Ambient -------------------------------------------------------------

  /**
   * Switch the ambient soundscape to match the current biome.
   * Currently all biomes use the same ambient_wind loop; future biomes can
   * branch here.
   */
  setAmbientBiome(_biome: Biome): void {
    // All biomes share the same wind ambient for now. Start it if not already
    // running (the engine de-duplicates by name).
    this.engine.startAmbient("ambient_wind");
  }
}
